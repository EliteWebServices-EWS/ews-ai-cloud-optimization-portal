import React from 'react';
import { mockClients, Client } from '../../mock/data';
import '../../styles/admin.css';

const AdminClientsPage: React.FC = () => {
  const [selectedClient, setSelectedClient] = React.useState<string | null>(null);

  return (
    <div style={styles.container}>
      {/* Header with role note */}
      <header style={styles.header}>
        <nav style={styles.nav}>
          <div style={styles.logo}>EWS Portal</div>
          <div style={styles.roleNote}>🔐 Admin‑only page (auth enforced later)</div>
        </nav>
      </header>

      <main style={styles.main}>
        {/* Page title */}
        <div style={styles.titleSection}>
          <h1 style={styles.title}>Admin Clients Management</h1>
          <p style={styles.subtitle}>View and manage connected client accounts</p>
        </div>

        {/* Clients Table */}
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.headerRow}>
                <th style={styles.headerCell}>Client Name</th>
                <th style={styles.headerCell}>AWS Account ID</th>
                <th style={styles.headerCell}>Status</th>
                <th style={styles.headerCell}>Last Sync</th>
                <th style={styles.headerCell}>Action</th>
              </tr>
            </thead>
            <tbody>
              {mockClients.map((client) => (
                <tr
                  key={client.id}
                  style={{
                    ...styles.bodyRow,
                    ...(selectedClient === client.id ? styles.selectedRow : {}),
                  }}
                  onClick={() => setSelectedClient(client.id)}
                >
                  <td style={styles.bodyCell}>{client.name}</td>
                  <td style={styles.bodyCell}>{client.awsAccountId}</td>
                  <td style={styles.bodyCell}>
                    <span
                      style={{
                        ...styles.statusBadge,
                        ...(client.status === 'Active'
                          ? styles.statusActive
                          : styles.statusPending),
                      }}
                    >
                      {client.status}
                    </span>
                  </td>
                  <td style={styles.bodyCell}>{client.lastSync}</td>
                  <td style={styles.bodyCell}>
                    <button
                      style={styles.viewButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        alert(`View details for ${client.name}`);
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary stats */}
        <div style={styles.statsSection}>
          <div style={styles.statCard}>
            <div style={styles.statNumber}>{mockClients.length}</div>
            <div style={styles.statLabel}>Total Clients</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statNumber}>
              {mockClients.filter((c) => c.status === 'Active').length}
            </div>
            <div style={styles.statLabel}>Active</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statNumber}>
              {mockClients.filter((c) => c.status === 'Pending').length}
            </div>
            <div style={styles.statLabel}>Pending</div>
          </div>
        </div>
      </main>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    backgroundColor: '#1a1a2e',
    color: '#e0e0e0',
    minHeight: '100vh',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  header: {
    borderBottom: '1px solid #333',
    backgroundColor: '#0f0f1e',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  nav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '1rem 2rem',
  },
  logo: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#fff',
  },
  roleNote: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#fbbf24',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    padding: '0.5rem 1rem',
    borderRadius: '6px',
    border: '1px solid rgba(251, 191, 36, 0.3)',
  },
  main: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '2rem 2rem',
  },
  titleSection: {
    marginBottom: '2rem',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 800,
    color: '#fff',
    margin: '0 0 0.5rem 0',
  },
  subtitle: {
    fontSize: '1rem',
    color: '#999',
    margin: 0,
  },
  tableContainer: {
    backgroundColor: '#0f0f1e',
    border: '1px solid #333',
    borderRadius: '8px',
    overflow: 'hidden',
    marginBottom: '2rem',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  headerRow: {
    backgroundColor: '#1a1a2e',
    borderBottom: '2px solid #333',
  },
  headerCell: {
    padding: '1rem',
    textAlign: 'left',
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#fbbf24',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  bodyRow: {
    borderBottom: '1px solid #333',
    transition: 'background-color 0.2s ease',
    cursor: 'pointer',
  },
  selectedRow: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
  },
  bodyCell: {
    padding: '1rem',
    fontSize: '0.95rem',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '0.35rem 0.75rem',
    borderRadius: '4px',
    fontSize: '0.8rem',
    fontWeight: 600,
    textTransform: 'capitalize',
  },
  statusActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    color: '#22c55e',
    border: '1px solid rgba(34, 197, 94, 0.4)',
  },
  statusPending: {
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    color: '#fbbf24',
    border: '1px solid rgba(251, 191, 36, 0.4)',
  },
  viewButton: {
    padding: '0.35rem 1rem',
    backgroundColor: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  },
  statsSection: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1.5rem',
  },
  statCard: {
    backgroundColor: '#0f0f1e',
    border: '1px solid #333',
    borderRadius: '8px',
    padding: '1.5rem',
    textAlign: 'center',
  },
  statNumber: {
    fontSize: '2.5rem',
    fontWeight: 800,
    color: '#fbbf24',
    marginBottom: '0.5rem',
  },
  statLabel: {
    fontSize: '0.9rem',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
};

export default AdminClientsPage;
