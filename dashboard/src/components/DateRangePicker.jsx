import { useState, useRef, useEffect } from 'react';
import './DateRangePicker.css';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function fromISO(s) {
  return new Date(s + 'T00:00:00');
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function gerarGrade(ano, mes) {
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const ultimoDia   = new Date(ano, mes + 1, 0).getDate();
  const grade = [];
  for (let i = 0; i < primeiroDia; i++) grade.push(null);
  for (let d = 1; d <= ultimoDia; d++) grade.push(new Date(ano, mes, d));
  while (grade.length % 7 !== 0) grade.push(null);
  return grade;
}

const hoje = () => toISO(new Date());
const ontem = () => toISO(addDays(new Date(), -1));

const PRESETS = [
  { label: 'Hoje',           fn: () => ({ ini: hoje(), fim: hoje() }) },
  { label: 'Ontem',          fn: () => ({ ini: ontem(), fim: ontem() }) },
  { label: 'Últimos 7 dias', fn: () => ({ ini: toISO(addDays(new Date(), -7)),  fim: ontem() }) },
  { label: 'Últimos 14 dias',fn: () => ({ ini: toISO(addDays(new Date(), -14)), fim: ontem() }) },
  { label: 'Últimos 30 dias',fn: () => ({ ini: toISO(addDays(new Date(), -30)), fim: ontem() }) },
  {
    label: 'Este mês',
    fn: () => {
      const n = new Date();
      return { ini: toISO(new Date(n.getFullYear(), n.getMonth(), 1)), fim: hoje() };
    },
  },
  {
    label: 'Mês passado',
    fn: () => {
      const n = new Date();
      return {
        ini: toISO(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
        fim: toISO(new Date(n.getFullYear(), n.getMonth(), 0)),
      };
    },
  },
];

export function labelPeriodo(ini, fim) {
  if (!ini || !fim) return 'Selecionar período';
  const h = hoje(), o = ontem();
  if (ini === fim) {
    if (ini === h) return 'Hoje';
    if (ini === o) return 'Ontem';
  }
  const d1 = fromISO(ini), d2 = fromISO(fim);
  const diffDias = Math.round((d2 - d1) / 86400000) + 1;
  if (fim === o) {
    if (diffDias === 7)  return 'Últimos 7 dias';
    if (diffDias === 14) return 'Últimos 14 dias';
    if (diffDias === 30) return 'Últimos 30 dias';
  }
  const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${fmt(d1)} – ${fmt(d2)}`;
}

export default function DateRangePicker({ dataInicio, dataFim, onChange }) {
  const [aberto, setAberto]       = useState(false);
  const [step, setStep]           = useState('idle'); // 'idle' | 'selecionando-fim'
  const [tempStart, setTempStart] = useState(null);
  const [pendIni, setPendIni]     = useState(dataInicio);
  const [pendFim, setPendFim]     = useState(dataFim);
  const [hoverIso, setHoverIso]   = useState(null);

  const n = new Date();
  const [mesEsq, setMesEsq] = useState({
    ano: n.getMonth() === 0 ? n.getFullYear() - 1 : n.getFullYear(),
    mes: n.getMonth() === 0 ? 11 : n.getMonth() - 1,
  });
  const mesDir = {
    mes: (mesEsq.mes + 1) % 12,
    ano: mesEsq.mes === 11 ? mesEsq.ano + 1 : mesEsq.ano,
  };

  const ref = useRef();
  useEffect(() => {
    if (!aberto) return;
    const fn = (e) => { if (!ref.current?.contains(e.target)) fechar(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [aberto]);

  function fechar() {
    setAberto(false);
    setStep('idle');
    setTempStart(null);
    setHoverIso(null);
    setPendIni(dataInicio);
    setPendFim(dataFim);
  }

  function handleDayClick(iso) {
    if (iso > hoje()) return;
    if (step === 'idle') {
      setTempStart(iso);
      setPendIni(iso);
      setPendFim(null);
      setStep('selecionando-fim');
    } else {
      const [ini, fim] = iso < tempStart ? [iso, tempStart] : [tempStart, iso];
      setPendIni(ini);
      setPendFim(fim);
      setStep('idle');
      setTempStart(null);
      setHoverIso(null);
    }
  }

  function rangePreview() {
    if (step === 'selecionando-fim' && tempStart && hoverIso) {
      return hoverIso < tempStart
        ? { ini: hoverIso, fim: tempStart }
        : { ini: tempStart, fim: hoverIso };
    }
    return { ini: pendIni, fim: pendFim };
  }

  function aplicarPreset({ ini, fim }) {
    setPendIni(ini);
    setPendFim(fim);
    setStep('idle');
    setTempStart(null);
    onChange({ dataInicio: ini, dataFim: fim });
    setAberto(false);
  }

  function aplicar() {
    if (pendIni && pendFim && step === 'idle') {
      onChange({ dataInicio: pendIni, dataFim: pendFim });
      setAberto(false);
    }
  }

  const prevMes = () => setMesEsq((m) => ({
    mes: m.mes === 0 ? 11 : m.mes - 1,
    ano: m.mes === 0 ? m.ano - 1 : m.ano,
  }));
  const nextMes = () => setMesEsq((m) => ({
    mes: (m.mes + 1) % 12,
    ano: m.mes === 11 ? m.ano + 1 : m.ano,
  }));

  const { ini: rIni, fim: rFim } = rangePreview();
  const labelAtual = labelPeriodo(dataInicio, dataFim);

  return (
    <div className="drp" ref={ref}>
      <button className={`drp-trigger ${aberto ? 'ativo' : ''}`} onClick={() => setAberto((v) => !v)}>
        <span className="drp-trigger-icone">📅</span>
        <span className="drp-trigger-label">{labelAtual}</span>
        <span className="drp-trigger-seta">{aberto ? '▴' : '▾'}</span>
      </button>

      {aberto && (
        <div className="drp-popover">
          {/* Presets */}
          <div className="drp-presets">
            {PRESETS.map((p) => {
              const { ini, fim } = p.fn();
              const ativo = ini === dataInicio && fim === dataFim;
              return (
                <button
                  key={p.label}
                  className={`drp-preset ${ativo ? 'ativo' : ''}`}
                  onClick={() => aplicarPreset(p.fn())}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Calendários */}
          <div className="drp-corpo">
            <MesCalendario
              ano={mesEsq.ano}
              mes={mesEsq.mes}
              rIni={rIni}
              rFim={rFim}
              onDayClick={handleDayClick}
              onDayHover={(iso) => step === 'selecionando-fim' && setHoverIso(iso)}
              onPrev={prevMes}
              showPrev
            />
            <div className="drp-divisor" />
            <MesCalendario
              ano={mesDir.ano}
              mes={mesDir.mes}
              rIni={rIni}
              rFim={rFim}
              onDayClick={handleDayClick}
              onDayHover={(iso) => step === 'selecionando-fim' && setHoverIso(iso)}
              onNext={nextMes}
              showNext
            />
          </div>

          {/* Rodapé */}
          <div className="drp-footer">
            <span className="drp-instrucao">
              {step === 'selecionando-fim'
                ? 'Clique na data de fim'
                : pendIni && pendFim
                ? labelPeriodo(pendIni, pendFim)
                : 'Clique na data de início'}
            </span>
            <button className="drp-btn drp-btn--cancelar" onClick={fechar}>
              Cancelar
            </button>
            <button
              className="drp-btn drp-btn--aplicar"
              disabled={!pendIni || !pendFim || step !== 'idle'}
              onClick={aplicar}
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MesCalendario({ ano, mes, rIni, rFim, onDayClick, onDayHover, onPrev, onNext, showPrev, showNext }) {
  const grade = gerarGrade(ano, mes);
  const maxIso = hoje();

  return (
    <div className="drp-mes">
      <div className="drp-mes-nav">
        {showPrev
          ? <button className="drp-nav-btn" onClick={onPrev}>‹</button>
          : <span className="drp-nav-ph" />}
        <span className="drp-mes-titulo">{MESES[mes]} {ano}</span>
        {showNext
          ? <button className="drp-nav-btn" onClick={onNext}>›</button>
          : <span className="drp-nav-ph" />}
      </div>

      <div className="drp-grade">
        {DIAS_SEMANA.map((d) => (
          <span key={d} className="drp-dia-label">{d}</span>
        ))}
        {grade.map((date, i) => {
          if (!date) return <span key={i} />;
          const iso = toISO(date);
          const futuro = iso > maxIso;
          const isHoje = iso === maxIso;
          const inRange = rIni && rFim && iso >= rIni && iso <= rFim;
          const isStart = iso === rIni;
          const isEnd   = iso === rFim;

          let cls = 'drp-dia';
          if (futuro)  cls += ' drp-dia--futuro';
          if (isHoje)  cls += ' drp-dia--hoje';
          if (inRange) cls += ' drp-dia--range';
          if (isStart) cls += ' drp-dia--borda-inicio';
          if (isEnd)   cls += ' drp-dia--borda-fim';
          if ((isStart || isEnd) && !futuro) cls += ' drp-dia--selecionado';

          return (
            <button
              key={i}
              className={cls}
              disabled={futuro}
              onClick={() => !futuro && onDayClick(iso)}
              onMouseEnter={() => !futuro && onDayHover?.(iso)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
