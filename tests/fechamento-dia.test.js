/**
 * Fechamento diário: o carimbo do snapshot final precisa vencer qualquer tick
 * horário do dia e ainda cair dentro do dia BRT que as consultas usam.
 */
import { describe, it, expect } from 'vitest';
import { carimboFechamentoDia } from '../src/core/coleta/coletor-metricas.servico.js';
import { dataBRT, DIAS_FECHAMENTO } from '../src/jobs/fechamento-dia.job.js';

describe('carimboFechamentoDia', () => {
  it('é 23:59 BRT do dia, ou seja, 02:59Z do dia seguinte', () => {
    expect(carimboFechamentoDia('2026-10-11').toISOString()).toBe('2026-10-12T02:59:00.000Z');
  });

  it('fica dentro do dia BRT das consultas e depois do último tick horário', () => {
    const carimbo = carimboFechamentoDia('2026-10-11');
    const inicioDia = new Date('2026-10-11T03:00:00Z');       // 00:00 BRT
    const fimExclusivo = new Date('2026-10-12T03:00:00Z');    // 00:00 BRT do dia seguinte
    const ultimoTick = new Date('2026-10-12T02:35:00Z');      // 23:35 BRT
    expect(carimbo >= inicioDia && carimbo < fimExclusivo).toBe(true);
    expect(carimbo > ultimoTick).toBe(true);
  });

  it('é determinístico: refazer o dia atualiza a mesma linha', () => {
    expect(carimboFechamentoDia('2026-09-02').getTime()).toBe(carimboFechamentoDia('2026-09-02').getTime());
  });

  it('rejeita data fora do formato', () => {
    expect(() => carimboFechamentoDia('11/10/2026')).toThrow();
  });
});

describe('janela do job', () => {
  it('cobre os 7 dias anteriores a hoje, sem incluir hoje', () => {
    const hoje = dataBRT(0);
    const desde = dataBRT(DIAS_FECHAMENTO);
    const ate = dataBRT(1);
    expect(ate < hoje).toBe(true);
    const dias = (new Date(`${ate}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)) / 86400000 + 1;
    expect(dias).toBe(7);
  });
});
