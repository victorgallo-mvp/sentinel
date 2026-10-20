/**
 * Registro de alterações: tradução dos eventos da Meta, chave de deduplicação
 * e vínculo autor → gestor. Tudo puro, sem banco.
 */
import { describe, it, expect } from 'vitest';
import { traduzirEvento, OBJETO } from '../src/core/alteracoes/dicionario-meta.js';
import { chaveEvento, resolverGestor, normalizarNome, montarLinha } from '../src/core/alteracoes/coletor-alteracoes.servico.js';

const evento = (sobrescreve = {}) => ({
  event_time: '2026-10-07T13:43:10+0000',
  event_type: 'update_ad_set_run_status',
  translated_event_type: 'Status do conjunto de anúncios atualizado',
  actor_id: '2261669507732615',
  actor_name: 'Nicollas Tavares',
  application_name: 'Power Editor',
  object_id: '120256400878570460',
  object_name: 'A ESCOLHA É SUA I HAWAI',
  object_type: 'CAMPAIGN',
  extra_data: JSON.stringify({ old_value: 'Ativo', new_value: 'Inativo', type: 'run_status' }),
  ...sobrescreve,
});

describe('traduzirEvento', () => {
  it('corrige a nomenclatura antiga da Meta', () => {
    expect(OBJETO.CAMPAIGN_GROUP).toBe('campanha');
    expect(OBJETO.CAMPAIGN).toBe('conjunto');
    expect(OBJETO.ADGROUP).toBe('anúncio');
  });

  it('pausa de conjunto vira frase de status, feita por pessoa', () => {
    const t = traduzirEvento(evento());
    expect(t.frase).toBe('pausou conjunto "A ESCOLHA É SUA I HAWAI"');
    expect(t.categoria).toBe('status');
    expect(t.sistema).toBe(false);
    expect(t.oculto).toBe(false);
  });

  it('transição para estado pendente é ruído de publicação, escondida', () => {
    const t = traduzirEvento(evento({ extra_data: JSON.stringify({ old_value: 'Processo pendente', new_value: 'Análise pendente' }) }));
    expect(t.oculto).toBe(true);
    expect(t.categoria).toBe('sistema');
  });

  it('orçamento mostra antes e depois em reais, lendo centavos', () => {
    const t = traduzirEvento(evento({
      event_type: 'update_ad_set_budget',
      extra_data: JSON.stringify({
        old_value: { type: 'payment_amount', currency: 'BRL', old_value: 1000 },
        new_value: { type: 'payment_amount', currency: 'BRL', new_value: 600, additional_value: 'Por dia' },
      }),
    }));
    expect(t.frase).toContain('de R$ 10,00 para R$ 6,00 por dia');
    expect(t.categoria).toBe('orcamento');
  });

  it('cobrança é da Meta: sistema, categoria faturamento', () => {
    const t = traduzirEvento(evento({
      event_type: 'ad_account_billing_charge', actor_id: '0', actor_name: 'Meta', object_type: 'ACCOUNT',
      extra_data: JSON.stringify({ currency: 'BRL', new_value: 6404, type: 'payment_amount' }),
    }));
    expect(t.frase).toBe('cobrança de R$ 64,04');
    expect(t.categoria).toBe('faturamento');
    expect(t.sistema).toBe(true);
  });

  it('tipo desconhecido cai no rótulo traduzido da própria Meta', () => {
    const t = traduzirEvento(evento({ event_type: 'algo_novo', translated_event_type: 'Algo novo' }));
    expect(t.frase).toContain('Algo novo');
  });
});

describe('chaveEvento', () => {
  it('é determinística e muda quando o conteúdo muda', () => {
    const a = chaveEvento('act_1', evento());
    expect(chaveEvento('act_1', evento())).toBe(a);
    expect(chaveEvento('act_2', evento())).not.toBe(a);
    expect(chaveEvento('act_1', evento({ extra_data: '{"x":1}' }))).not.toBe(a);
  });
});

describe('resolverGestor', () => {
  const gestores = [
    { _id: 'g1', nome: 'Nicollas Tavares', metaAtores: [] },
    { _id: 'g2', nome: 'João Pedro', metaAtores: [{ id: '777', nome: 'Joao P.' }] },
  ];

  it('vínculo explícito vence o nome', () => {
    expect(resolverGestor(gestores, '777', 'Outro Nome')).toBe('g2');
  });

  it('casa pelo nome ignorando acento e caixa', () => {
    expect(resolverGestor(gestores, '1', 'nicollas tavares')).toBe('g1');
    expect(resolverGestor(gestores, '2', 'JOAO PEDRO')).toBe('g2');
  });

  it('autor desconhecido ou a própria Meta fica sem gestor', () => {
    expect(resolverGestor(gestores, '3', 'Fulano')).toBeNull();
    expect(resolverGestor(gestores, '0', 'Meta')).toBeNull();
  });

  it('normalizarNome tira acento e espaços repetidos', () => {
    expect(normalizarNome('  João   Pedro ')).toBe('joao pedro');
  });
});

describe('montarLinha', () => {
  it('resolve a campanha pela hierarquia e carrega o evento bruto', () => {
    const campanhas = new Map([['120256400878570460', { campanhaId: 'c1', campanhaNome: 'Vendedora Priscila' }]]);
    const linha = montarLinha({ identificador: 'dilson' }, 'act_1', evento(), [{ _id: 'g1', nome: 'Nicollas Tavares', metaAtores: [] }], campanhas);
    expect(linha.conta_id).toBe('dilson');
    expect(linha.campanha_nome).toBe('Vendedora Priscila');
    expect(linha.gestor_id).toBe('g1');
    expect(linha.objeto_tipo).toBe('conjunto');
    expect(JSON.parse(linha.dados).event_type).toBe('update_ad_set_run_status');
    expect(linha.ocorrida_em.toISOString()).toBe('2026-10-07T13:43:10.000Z');
  });
});
