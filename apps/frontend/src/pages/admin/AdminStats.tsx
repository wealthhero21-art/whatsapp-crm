import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export function AdminStats() {
  const statsQ = useQuery({ queryKey: ['stats'], queryFn: api.admin.stats, refetchInterval: 30_000 });
  const s = statsQ.data;
  return (
    <section className="page">
      <header className="page-head"><h1>Stats</h1></header>
      {!s ? <div>Loading…</div> : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="kpi-label">Unassigned leads</div><div className="kpi-value">{s.unassigned}</div></div>
            <div className="kpi"><div className="kpi-label">Active agents</div><div className="kpi-value">{s.by_agent.length}</div></div>
          </div>
          <div className="card">
            <h3>By status</h3>
            <table className="data">
              <tbody>
                {s.by_status.map((row) => (
                  <tr key={row.status}><td>{row.status}</td><td>{row.count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>By source</h3>
            <table className="data">
              <tbody>
                {s.by_source.map((row, i) => (
                  <tr key={i}><td>{row.source}</td><td>{row.count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Open load per agent</h3>
            <table className="data">
              <tbody>
                {s.by_agent.map((a) => (
                  <tr key={a.id}><td>{a.name}</td><td>{a.open_leads}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
