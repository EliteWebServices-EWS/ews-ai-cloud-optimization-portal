import React from 'react';
import '../styles/brand-colors.css';
import '../styles/main.css';

const TermsPage: React.FC = () => {
  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <nav style={styles.nav}>
          <div style={styles.logo}>EWS Portal</div>
          <ul style={styles.navList}>
            <li><a href="../index.html" style={styles.navLink}>Dashboard</a></li>
            <li><a href="services.html" style={styles.navLink}>Services</a></li>
            <li><a href="assessment.html" style={styles.navLink}>Assessment</a></li>
            <li><a href="security.html" style={styles.navLink}>Security</a></li>
          </ul>
        </nav>
      </header>

      <main style={styles.main}>
        {/* Hero Section */}
        <section style={styles.hero}>
          <div style={styles.heroContent}>
            <h1 style={styles.heroTitle}>Terms of Service</h1>
            <p style={styles.heroDescription}>
              Please read these terms carefully before using Elite Web Services
            </p>
          </div>
        </section>

        {/* Terms Content */}
        <section style={styles.contentSection}>
          {/* Advisory Service */}
          <div style={styles.disclaimerCard}>
            <div style={styles.cardIcon}>⚠️</div>
            <h2 style={styles.disclaimerTitle}>Advisory-Only Service</h2>
            <p style={styles.disclaimerText}>
              Elite Web Services (EWS) provides advisory, analysis, and recommendations for your cloud infrastructure and operations. Our service is informational and consultative in nature. We do not provide direct operational control, infrastructure management, or guarantees of system availability or performance. All recommendations are provided as guidance only, and you remain responsible for evaluating and implementing any changes to your environment.
            </p>
          </div>

          {/* No Financial Guarantees */}
          <div style={styles.disclaimerCard}>
            <div style={styles.cardIcon}>💰</div>
            <h2 style={styles.disclaimerTitle}>No Financial Guarantees</h2>
            <p style={styles.disclaimerText}>
              While we provide cost optimization analysis and recommendations, EWS does not guarantee specific cost reductions, financial returns, or savings. Actual results depend on your infrastructure, implementation decisions, and market conditions. Our cost projections and savings estimates are based on analysis of your environment and may not reflect actual outcomes. You are responsible for validating all financial projections before making business decisions.
            </p>
          </div>

          {/* AWS Charges Liability */}
          <div style={styles.disclaimerCard}>
            <div style={styles.cardIcon}>🔗</div>
            <h2 style={styles.disclaimerTitle}>No Liability for AWS Charges</h2>
            <p style={styles.disclaimerText}>
              EWS is not responsible for any AWS bills, charges, or unexpected costs incurred in your account. You maintain full control and responsibility for your AWS infrastructure and all associated costs. While we provide visibility and optimization recommendations, you are solely responsible for managing your AWS account, approving any changes, and monitoring your billing. EWS assumes no liability for any cloud service charges regardless of whether they result from our recommendations or independent actions.
            </p>
          </div>

          {/* Customer Responsibility */}
          <div style={styles.disclaimerCard}>
            <div style={styles.cardIcon}>✓</div>
            <h2 style={styles.disclaimerTitle}>Customer Responsibility Clause</h2>
            <p style={styles.disclaimerText}>
              You acknowledge and agree that:
            </p>
            <ul style={styles.responsibilityList}>
              <li>You have full authority and responsibility for all actions taken in your AWS account</li>
              <li>You will review all recommendations and make independent decisions before implementation</li>
              <li>You maintain backup and disaster recovery procedures for all critical systems</li>
              <li>You are responsible for testing changes in non-production environments before deploying to production</li>
              <li>You maintain all necessary compliance, security, and governance controls independent of EWS services</li>
              <li>You are responsible for monitoring your AWS account, costs, and security posture</li>
              <li>You will not implement any recommendations without proper testing and approval from your team</li>
              <li>You acknowledge that any changes to your infrastructure carry inherent risks</li>
            </ul>
          </div>

          {/* Limitation of Liability */}
          <div style={styles.disclaimerCard}>
            <div style={styles.cardIcon}>⚖️</div>
            <h2 style={styles.disclaimerTitle}>Limitation of Liability</h2>
            <p style={styles.disclaimerText}>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, ELITE WEB SERVICES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA LOSS, BUSINESS INTERRUPTION, OR ANY OTHER DAMAGES RESULTING FROM YOUR USE OF OR INABILITY TO USE OUR SERVICES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
            </p>
          </div>

          {/* Support and Contact */}
          <div style={styles.disclaimerCard}>
            <div style={styles.cardIcon}>📞</div>
            <h2 style={styles.disclaimerTitle}>Questions?</h2>
            <p style={styles.disclaimerText}>
              If you have questions about these terms or our service agreements, please contact us at{' '}
              <a href="mailto:support@elitewebservices.com" style={styles.contactLink}>
                support@elitewebservices.com
              </a>
            </p>
          </div>
        </section>

        {/* Last Updated */}
        <div style={styles.lastUpdated}>
          <p>Last Updated: June 25, 2026</p>
        </div>
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <div style={styles.footerContent}>
          <div style={styles.footerLinks}>
            <a href="terms.html" style={styles.footerLink}>Terms</a>
            <span style={styles.footerDivider}>•</span>
            <a href="privacy.html" style={styles.footerLink}>Privacy</a>
            <span style={styles.footerDivider}>•</span>
            <a href="security.html" style={styles.footerLink}>Security</a>
          </div>
          <p style={styles.footerCopy}>&copy; 2026 Elite Web Services. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    backgroundColor: 'var(--ews-black)',
    color: 'var(--ews-white)',
    minHeight: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  header: {
    borderBottom: '1px solid var(--ews-gray-700)',
    backgroundColor: 'var(--ews-black)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  nav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '1rem 2rem',
  },
  logo: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: 'var(--ews-white)',
  },
  navList: {
    display: 'flex',
    listStyle: 'none',
    gap: '2rem',
    margin: 0,
    padding: 0,
  },
  navLink: {
    color: 'var(--ews-gray-300)',
    textDecoration: 'none',
    fontSize: '0.95rem',
    transition: 'color 0.2s ease',
    cursor: 'pointer',
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '0 2rem',
  },
  hero: {
    paddingTop: '4rem',
    paddingBottom: '2rem',
    textAlign: 'center',
  },
  heroContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 'clamp(2rem, 5vw, 3rem)',
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: '-1.5px',
    margin: '0 0 1rem 0',
  },
  heroDescription: {
    color: 'var(--ews-gray-300)',
    fontSize: '1rem',
    maxWidth: '600px',
    margin: '0 auto',
    lineHeight: 1.7,
  },
  contentSection: {
    paddingTop: '2rem',
    paddingBottom: '4rem',
  },
  disclaimerCard: {
    backgroundColor: 'var(--ews-gray-900)',
    border: '1px solid var(--ews-gray-700)',
    borderRadius: '12px',
    padding: '2rem',
    marginBottom: '1.5rem',
    borderLeft: '4px solid var(--ews-gold)',
  },
  cardIcon: {
    fontSize: '2rem',
    marginBottom: '1rem',
  },
  disclaimerTitle: {
    fontSize: '1.35rem',
    fontWeight: 700,
    color: 'var(--ews-white)',
    margin: '0 0 1rem 0',
    letterSpacing: '-0.3px',
  },
  disclaimerText: {
    color: 'var(--ews-gray-300)',
    fontSize: '0.95rem',
    lineHeight: 1.75,
    margin: '0 0 0.75rem 0',
  },
  responsibilityList: {
    color: 'var(--ews-gray-300)',
    fontSize: '0.95rem',
    lineHeight: 1.75,
    margin: '1rem 0 0 0',
    paddingLeft: '1.5rem',
    listStyle: 'disc',
  },
  contactLink: {
    color: 'var(--ews-gold)',
    textDecoration: 'none',
    fontWeight: 600,
    transition: 'opacity 0.2s ease',
  },
  lastUpdated: {
    textAlign: 'center',
    color: 'var(--ews-gray-500)',
    fontSize: '0.85rem',
    padding: '1rem 0 2rem 0',
  },
  footer: {
    borderTop: '1px solid var(--ews-gray-700)',
    backgroundColor: 'var(--ews-black)',
    padding: '2rem',
  },
  footerContent: {
    maxWidth: '1200px',
    margin: '0 auto',
    textAlign: 'center',
  },
  footerLinks: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1rem',
  },
  footerLink: {
    color: 'var(--ews-gray-300)',
    textDecoration: 'none',
    fontSize: '0.9rem',
    transition: 'color 0.2s ease',
    cursor: 'pointer',
  },
  footerDivider: {
    color: 'var(--ews-gray-500)',
  },
  footerCopy: {
    color: 'var(--ews-gray-300)',
    fontSize: '0.85rem',
    margin: 0,
  },
};

export default TermsPage;
