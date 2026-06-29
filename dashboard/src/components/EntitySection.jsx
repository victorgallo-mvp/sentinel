import MetricCard from './MetricCard.jsx';
import './EntitySection.css';

export default function EntitySection({ entidade }) {
  const semDados = entidade.metricas.every((m) => m.atual === null);
  const visiveis = entidade.metricas.filter((m) => m.atual !== null);
  const doPeriodo = visiveis.filter((m) => m.janela !== '30d');
  const de30d = visiveis.filter((m) => m.janela === '30d');

  return (
    <div className="entity-section">
      <div className="entity-header">
        <span className="entity-nome">{entidade.nome}</span>
        <span className="entity-tipo">{entidade.tipo}</span>
        {entidade.ultimaSincronizacao && (
          <span className="entity-sinc">
            última coleta: {new Date(entidade.ultimaSincronizacao).toLocaleString('pt-BR')}
          </span>
        )}
      </div>

      {semDados ? (
        <p className="entity-vazia">Sem dados coletados ainda — campanha pausada ou aguardando primeira coleta.</p>
      ) : (
        <>
          <div className="metricas-grid">
            {doPeriodo.map((m) => (
              <MetricCard key={m.chave} metrica={m} />
            ))}
          </div>
          {de30d.length > 0 && (
            <>
              <div className="metricas-divisor">Últimos 30 dias · atualiza 1×/dia</div>
              <div className="metricas-grid">
                {de30d.map((m) => (
                  <MetricCard key={m.chave} metrica={m} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
