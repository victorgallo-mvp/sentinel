/**
 * Alerta de fim de semana: a conta de quantas horas faltam até a segunda-feira
 * é o que decide se o aviso dispara.
 */
import { describe, it, expect } from 'vitest';
import { horasAteSegunda } from '../src/core/alertas/alerta-fim-semana.servico.js';
import { resolverDestinatarios } from '../src/core/notificacao/enviador-whatsapp.servico.js';

// Constrói um instante a partir de uma hora BRT (BRT = UTC-3).
const brt = (iso, hora) => new Date(`${iso}T${String(hora + 3).padStart(2, '0')}:00:00Z`);

describe('horasAteSegunda', () => {
  it('sexta ao meio-dia precisa cobrir quase três dias', () => {
    // sexta 18/09/2026 12h BRT -> segunda 21/09 09h BRT = 69h
    expect(horasAteSegunda(brt('2026-09-18', 12))).toBe(69);
  });

  it('sábado precisa cobrir menos que sexta', () => {
    const sexta = horasAteSegunda(brt('2026-09-18', 12));
    const sabado = horasAteSegunda(brt('2026-09-19', 12));
    expect(sabado).toBeLessThan(sexta);
    expect(sabado).toBe(45);
  });

  it('na segunda-feira olha para a semana seguinte, nunca devolve zero ou negativo', () => {
    const h = horasAteSegunda(brt('2026-09-21', 12));
    expect(h).toBeGreaterThan(0);
    expect(h).toBe(165); // 7 dias menos as 3h já passadas
  });

  it('é sempre positivo em qualquer dia da semana', () => {
    for (const dia of ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']) {
      expect(horasAteSegunda(brt(dia, 12))).toBeGreaterThan(0);
    }
  });
});

describe('resolverDestinatarios com extras', () => {
  const conta = { notificacao: { whatsappJid: '5511111@s.whatsapp.net', whatsappJids: ['5522222@s.whatsapp.net'] } };

  it('soma o número do gestor aos da conta', () => {
    const r = resolverDestinatarios(conta, { extras: ['5533333@s.whatsapp.net'] });
    expect(r).toEqual(['5511111@s.whatsapp.net', '5522222@s.whatsapp.net', '5533333@s.whatsapp.net']);
  });

  it('não duplica quando o gestor já é contato da conta', () => {
    const r = resolverDestinatarios(conta, { extras: ['5511111@s.whatsapp.net'] });
    expect(r).toEqual(['5511111@s.whatsapp.net', '5522222@s.whatsapp.net']);
  });

  it('ignora extras vazios', () => {
    expect(resolverDestinatarios(conta, { extras: [undefined, '', null] }))
      .toEqual(['5511111@s.whatsapp.net', '5522222@s.whatsapp.net']);
  });

  it('sem extras, comporta-se como antes', () => {
    expect(resolverDestinatarios(conta)).toEqual(['5511111@s.whatsapp.net', '5522222@s.whatsapp.net']);
  });
});
