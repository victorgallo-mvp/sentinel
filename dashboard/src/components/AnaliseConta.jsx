import './AnaliseConta.css';

const ROTULO_SITUACAO = { saudavel: 'Saudável', atencao: 'Atenção', critico: 'Crítico' };

/** Formata conforme a natureza da métrica — dinheiro, percentual ou contagem. */
function fmt(chave, valor) {
  if (valor == null) return '—';
  if (chave === 'gasto' || chave === 'custoPorResultado' || chave === 'cpcLink') {
    return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (chave === 'ctrLink') return `${valor.toFixed(2)}%`;
  if (chave === 'roas') return `${valor.toFixed(2)}x`;
  return Math.round(valor).toLocaleString('pt-BR');
}

function dataCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Leitura da triagem + comparativo em NÚMEROS ABSOLUTOS.
 *
 * Sem percentual: o valor anterior fica ao lado, então a variação é visível sem
 * precisar de um número que esconde a base. "13 conversas (antes 2)" diz o que
 * "+457%" mentia por omissão.
 *
 * A cobertura aparece quando algum período tem dias faltando — um total medido
 * em 24 de 30 dias parece queda sem que nada tenha acontecido com as campanhas.
 */
export default function AnaliseConta({ analise }) {
  if (!analise?.resumo) return null;

  const { situacao, resumo, fatores = [], acao, comparativo = [], cobertura, nivelConta, analisadaEm } = analise;
  const faltam7  = cobertura && cobertura.dias7  < 7;
  const faltam30 = cobertura && cobertura.dias30 < 30;

  return (
    <div className={`anl anl--${situacao}`}>
      <div className="anl-head">
        <span className={`anl-selo anl-selo--${situacao}`}>{ROTULO_SITUACAO[situacao] ?? situacao}</span>
        <span className="anl-data">análise de {dataCurta(analisadaEm)}</span>
      </div>

      <p className="anl-resumo">{resumo}</p>

      {fatores.length > 0 && (
        <ul className="anl-fatores">
          {fatores.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}

      {acao && <p className="anl-acao"><strong>Ação:</strong> {acao}</p>}

      {comparativo.length > 0 && (
        <div className="anl-tabela-wrap">
          <table className="anl-tabela">
            <thead>
              <tr>
                <th></th>
                <th colSpan="2">7 dias{faltam7 ? ` · ${cobertura.dias7} de 7 medidos` : ''}</th>
                <th colSpan="2">30 dias{faltam30 ? ` · ${cobertura.dias30} de 30 medidos` : ''}</th>
              </tr>
              <tr className="anl-sub">
                <th></th>
                <th>agora</th><th>antes</th>
                <th>agora</th><th>antes</th>
              </tr>
            </thead>
            <tbody>
              {comparativo.map((l) => (
                <tr key={l.chave}>
                  <td className="anl-rot">{l.rotulo}</td>
                  <td className="anl-n">{fmt(l.chave, l.seteDias?.atual)}</td>
                  <td className="anl-n anl-antes">{fmt(l.chave, l.seteDias?.anterior)}</td>
                  <td className="anl-n">{fmt(l.chave, l.trintaDias?.atual)}</td>
                  <td className="anl-n anl-antes">{fmt(l.chave, l.trintaDias?.anterior)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nivelConta?.alcance30d && (
        <p className="anl-rodape">
          Alcance de 30 dias: {Math.round(nivelConta.alcance30d).toLocaleString('pt-BR')} pessoas
          {nivelConta.frequencia30d ? ` · frequência ${nivelConta.frequencia30d.toFixed(1)}x` : ''}
          <span className="anl-nota"> — deduplicado no nível da conta</span>
        </p>
      )}
    </div>
  );
}
