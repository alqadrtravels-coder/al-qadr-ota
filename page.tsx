const metrics = [
  { label: "Bookings today", value: "—", note: "Connect booking module in a later phase" },
  { label: "Wallet transactions", value: "—", note: "Finance module not enabled yet" },
  { label: "Active partners", value: "—", note: "B2B module not enabled yet" },
  { label: "Supplier status", value: "MOCK", note: "No live supplier calls are enabled" },
];

const work = [
  ["Phase 1 · Architecture", "Revised architecture and Prisma schema included in this project."],
  ["Phase 2 · Foundation", "Initial frontend and API shells are ready for local setup and validation."],
  ["Next required step", "Validate the schema, then implement authentication and authorization before finance or bookings."],
];

export default function HomePage() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">AL-QADR <small>TRAVELS & TOURS · OTA</small></div>
        <div className="nav-label">Workspace</div>
        <a className="nav-item active" href="/">Overview</a>
        <a className="nav-item" href="#roadmap">Development roadmap</a>
        <div className="nav-label">Coming in later phases</div>
        <span className="nav-item">B2B partners</span>
        <span className="nav-item">Flight bookings</span>
        <span className="nav-item">Wallet & finance</span>
        <span className="nav-item">Supplier management</span>
        <span className="nav-item">Reports</span>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>Operations console / Overview</span>
          <div className="avatar" aria-label="Al-Qadr">AQ</div>
        </header>
        <div className="content">
          <div className="eyebrow">Al-Qadr Travels & Tours</div>
          <h1>OTA operations console</h1>
          <p className="lead">The foundation for your B2B and B2C travel platform. Modules will be enabled progressively after the database, security and integration layers pass validation.</p>
          <div className="cards">
            {metrics.map((m) => <section className="card" key={m.label}>
              <div className="card-label">{m.label}</div>
              <div className="card-value">{m.value}</div>
              <div className="card-note">{m.note}</div>
            </section>)}
          </div>
          <div className="section-grid" id="roadmap">
            <section className="card">
              <div className="section-title">Project progress</div>
              {work.map(([title, desc]) => <div className="list-row" key={title}>
                <span className="dot" />
                <div><strong>{title}</strong><p>{desc}</p></div>
              </div>)}
            </section>
            <section className="card">
              <div className="section-title">Environment status</div>
              <div className="list-row"><span className="dot" /><div><strong>Live supplier connections</strong><p>Disabled intentionally until credentials and API approval are available.</p></div></div>
              <div className="list-row"><span className="dot" /><div><strong>Production deployment</strong><p>Not configured. Do not expose this starter as a live booking system.</p></div></div>
              <div className="list-row"><span className="dot" /><div><strong>Security controls</strong><p>Authentication, 2FA and RBAC are planned; they are not complete in this starter.</p></div></div>
              <p className="footer-note"><span className="status">DEVELOPMENT STARTER</span><br /><br />No real bookings, ticketing, customer records or financial transactions are processed by this screen.</p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
