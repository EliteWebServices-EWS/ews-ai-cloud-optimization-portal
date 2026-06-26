import React from 'react';
import '../styles/brand-colors.css';
import '../styles/main.css';

interface Service {
  id: string;
  title: string;
  icon: string;
  whatItDoes: string;
  businessOutcome: string;
  tags: string[];
  featured?: boolean;
}

const services: Service[] = [
  {
    id: 'cost-optimization',
    title: 'Cost Optimization',
    icon: '💰',
    whatItDoes: 'Identify and eliminate unnecessary cloud spending through continuous analysis, rightsizing recommendations, and waste elimination. We analyze your infrastructure to find opportunities for immediate savings.',
    businessOutcome: 'Reduce cloud costs by 20–40% while maintaining or improving performance and reliability.',
    tags: ['Rightsizing', 'Waste Elimination', 'Budget Control'],
    featured: true,
  },
  {
    id: 'finops-reporting',
    title: 'FinOps Reporting',
    icon: '📊',
    whatItDoes: 'Detailed cloud cost analytics, forecasting, and trend analysis. Real-time dashboards show spending patterns across teams, projects, and cost centers with predictive budgeting models.',
    businessOutcome: 'Gain full visibility into cloud spending and make data-driven decisions on resource allocation and investment.',
    tags: ['Analytics', 'Forecasting', 'Dashboards'],
  },
  {
    id: 'security-visibility',
    title: 'Security Visibility',
    icon: '🔒',
    whatItDoes: 'Monitor and audit your security posture across cloud infrastructure. Identify misconfigurations, unencrypted data, overly permissive access, and compliance gaps in real time.',
    businessOutcome: 'Detect vulnerabilities and compliance issues before they become security incidents or regulatory violations.',
    tags: ['Monitoring', 'Compliance', 'Threat Detection'],
  },
  {
    id: 'governance-automation',
    title: 'Governance & Automation',
    icon: '⚙️',
    whatItDoes: 'Enforce consistent policies and automate compliance controls across your cloud environment. Prevent policy violations at resource creation, not after.',
    businessOutcome: 'Reduce manual security and compliance overhead while ensuring consistent standards across all cloud resources.',
    tags: ['Policy Enforcement', 'Automation', 'Compliance'],
  },
  {
    id: 'ews-lite-access',
    title: 'EWS‑Lite Access',
    icon: '👥',
    whatItDoes: 'Lightweight dashboard and reporting portal for stakeholders. Finance, engineering, and leadership teams get self-service access to cost data, security metrics, and governance status without granting direct AWS access.',
    businessOutcome: 'Enable self-service visibility and reporting while maintaining security and reducing support requests.',
    tags: ['Self-Service', 'Reporting', 'Access Control'],
  },
];

const ServicesPage: React.FC = () => {
  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <nav style={styles.nav}>
          <div style={styles.logo}>EWS Portal</div>
          <ul style={styles.navList}>
            <li><a href="../index.html" style={styles.navLink}>Dashboard</a></li>
            <li><a href="services.html" style={{...styles.navLink, color: 'var(--ews-gold)'}}>Services</a></li>
            <li><a href="assessment.html" style={styles.navLink}>Assessment</a></li>
            <li><a href="security.html" style={styles.navLink}>Security</a></li>
          </ul>
        </nav>
      </header>

      <main style={styles.main}>
        {/* Hero Section */}
        <section style={styles.hero}>
          <div style={styles.heroContent}>
            <span style={styles.eyebrow}>Cloud Intelligence Platform</span>
            <h1 style={styles.heroTitle}>
              Five powerful services to <span style={styles.highlight}>optimize your cloud</span>
            </h1>
            <p style={styles.heroDescription}>
              From cost visibility to security governance — Elite Web Services delivers the intelligence and automation you need to run a mature, compliant AWS environment.
            </p>
            <a href="contact.html" style={styles.heroCta}>
              Book a Free Consultation
              <span style={styles.ctaArrow}>→</span>
            </a>
          </div>
        </section>

        {/* Services Grid */}
        <section style={styles.servicesSection}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionEyebrow}>Core Capabilities</div>
            <h2 style={styles.sectionTitle}>Our Services</h2>
            <p style={styles.sectionDescription}>
              Each service is designed to solve a critical challenge in modern cloud operations.
            </p>
          </div>

          <div style={styles.servicesGrid}>
            {services.map((service) => (
              <div
                key={service.id}
                style={{
                  ...styles.serviceCard,
                  ...(service.featured ? styles.serviceCardFeatured : {}),
                }}
              >
                {service.featured && <span style={styles.featuredBadge}>Most Popular</span>}

                <div style={styles.serviceIcon}>{service.icon}</div>

                <h3 style={styles.serviceTitle}>{service.title}</h3>

                <div style={styles.serviceContent}>
                  <div style={styles.serviceSection}>
                    <h4 style={styles.subsectionTitle}>What It Does</h4>
                    <p style={styles.serviceText}>{service.whatItDoes}</p>
                  </div>

                  <div style={styles.serviceSection}>
                    <h4 style={styles.subsectionTitle}>Business Outcome</h4>
                    <p style={{...styles.serviceText, ...styles.outcomeText}}>
                      {service.businessOutcome}
                    </p>
                  </div>
                </div>

                <div style={styles.serviceTags}>
                  {service.tags.map((tag) => (
                    <span key={tag} style={styles.serviceTag}>{tag}</span>
                  ))}
                </div>

                <a href="contact.html" style={styles.cardLink}>
                  Learn More <span style={styles.linkArrow}>→</span>
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* CTA Section */}
        <section style={styles.ctaSection}>
          <h2 style={styles.ctaTitle}>Ready to take control of your cloud?</h2>
          <p style={styles.ctaText}>
            Start with a free 30-minute discovery call to see how EWS can help you optimize costs, secure your infrastructure, and simplify governance.
          </p>
          <div style={styles.ctaButtons}>
            <a href="contact.html" style={styles.btnPrimary}>
              Book a Discovery Call
              <span style={styles.ctaArrow}>→</span>
            </a>
            <a href="assessment.html" style={styles.btnOutline}>
              Run an Assessment
            </a>
          </div>
        </section>
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
    paddingTop: '5rem',
    paddingBottom: '4rem',
    textAlign: 'center',
  },
  heroContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  eyebrow: {
    display: 'inline-block',
    fontSize: '0.75rem',
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'var(--ews-gold)',
    border: '1px solid rgba(219,172,24,0.3)',
    borderRadius: '100px',
    padding: '0.35rem 1rem',
    marginBottom: '1.75rem',
  },
  heroTitle: {
    fontSize: 'clamp(2rem, 5vw, 3.5rem)',
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: '-1.5px',
    maxWidth: '760px',
    margin: '0 0 1.25rem 0',
  },
  highlight: {
    background: 'linear-gradient(135deg, var(--ews-gold-light), var(--ews-gold))',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  heroDescription: {
    color: 'var(--ews-gray-300)',
    fontSize: '1.1rem',
    maxWidth: '600px',
    margin: '0 auto 2.5rem',
    lineHeight: 1.7,
  },
  heroCta: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    backgroundColor: 'var(--ews-gold)',
    color: 'var(--ews-black)',
    fontWeight: 700,
    fontSize: '0.95rem',
    padding: '0.85rem 2rem',
    borderRadius: '8px',
    textDecoration: 'none',
    transition: 'background 0.2s ease, transform 0.2s ease',
    cursor: 'pointer',
    border: 'none',
  },
  ctaArrow: {
    fontSize: '1.2rem',
  },
  servicesSection: {
    paddingTop: '4rem',
    paddingBottom: '5rem',
  },
  sectionHeader: {
    marginBottom: '3rem',
    textAlign: 'center',
  },
  sectionEyebrow: {
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'var(--ews-gold)',
    marginBottom: '0.6rem',
  },
  sectionTitle: {
    fontSize: 'clamp(1.5rem, 3vw, 2.25rem)',
    fontWeight: 800,
    color: 'var(--ews-white)',
    letterSpacing: '-0.5px',
    margin: '0 0 0.75rem',
  },
  sectionDescription: {
    color: 'var(--ews-gray-300)',
    margin: '0',
    maxWidth: '560px',
    margin: '0 auto',
    lineHeight: 1.65,
  },
  servicesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '1.5rem',
  },
  serviceCard: {
    backgroundColor: 'var(--ews-gray-900)',
    border: '1px solid var(--ews-gray-700)',
    borderRadius: '14px',
    padding: '2rem',
    position: 'relative',
    overflow: 'hidden',
    transition: 'border-color 0.25s ease, transform 0.25s ease',
    display: 'flex',
    flexDirection: 'column',
  },
  serviceCardFeatured: {
    borderColor: 'rgba(219,172,24,0.3)',
    background: 'linear-gradient(135deg, rgba(219,172,24,0.06), var(--ews-gray-900))',
  },
  featuredBadge: {
    position: 'absolute',
    top: '1.25rem',
    right: '1.25rem',
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    backgroundColor: 'var(--ews-gold)',
    color: 'var(--ews-black)',
    padding: '0.2rem 0.55rem',
    borderRadius: '4px',
  },
  serviceIcon: {
    fontSize: '2.5rem',
    marginBottom: '1.25rem',
  },
  serviceTitle: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: 'var(--ews-white)',
    margin: '0 0 1.25rem',
    letterSpacing: '-0.2px',
  },
  serviceContent: {
    flex: 1,
    marginBottom: '1.25rem',
  },
  serviceSection: {
    marginBottom: '1.5rem',
  },
  subsectionTitle: {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--ews-gold)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    margin: '0 0 0.5rem',
  },
  serviceText: {
    fontSize: '0.9rem',
    color: 'var(--ews-gray-300)',
    lineHeight: 1.65,
    margin: 0,
  },
  outcomeText: {
    fontWeight: 600,
    color: 'var(--ews-gold)',
  },
  serviceTags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.4rem',
    marginBottom: '1.5rem',
  },
  serviceTag: {
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '0.2rem 0.6rem',
    borderRadius: '4px',
    backgroundColor: 'rgba(219,172,24,0.1)',
    color: 'var(--ews-gold)',
    border: '1px solid rgba(219,172,24,0.2)',
    letterSpacing: '0.04em',
  },
  cardLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--ews-gold)',
    textDecoration: 'none',
    transition: 'gap 0.2s ease, color 0.2s ease',
    cursor: 'pointer',
  },
  linkArrow: {
    fontSize: '1rem',
  },
  ctaSection: {
    backgroundColor: 'linear-gradient(135deg, rgba(219,172,24,0.12), rgba(219,172,24,0.04))',
    border: '1px solid rgba(219,172,24,0.25)',
    borderRadius: '16px',
    padding: '3.5rem 3rem',
    textAlign: 'center',
    marginBottom: '5rem',
    marginTop: '3rem',
  },
  ctaTitle: {
    fontSize: 'clamp(1.5rem, 3.5vw, 2.25rem)',
    fontWeight: 800,
    color: 'var(--ews-white)',
    letterSpacing: '-0.5px',
    marginBottom: '0.75rem',
    margin: '0 0 0.75rem',
  },
  ctaText: {
    color: 'var(--ews-gray-300)',
    fontSize: '1rem',
    maxWidth: '520px',
    margin: '0 auto 2rem',
    lineHeight: 1.65,
  },
  ctaButtons: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    backgroundColor: 'var(--ews-gold)',
    color: 'var(--ews-black)',
    fontWeight: 700,
    fontSize: '0.9rem',
    padding: '0.85rem 1.75rem',
    borderRadius: '8px',
    textDecoration: 'none',
    transition: 'background 0.2s, transform 0.2s',
    cursor: 'pointer',
    border: 'none',
  },
  btnOutline: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    backgroundColor: 'transparent',
    color: 'var(--ews-white)',
    fontWeight: 600,
    fontSize: '0.9rem',
    padding: '0.85rem 1.75rem',
    borderRadius: '8px',
    textDecoration: 'none',
    border: '1px solid var(--ews-gray-700)',
    transition: 'border-color 0.2s, transform 0.2s',
    cursor: 'pointer',
  },
  footer: {
    borderTop: '1px solid var(--ews-gray-700)',
    backgroundColor: 'var(--ews-black)',
    padding: '2rem',
    marginTop: '3rem',
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

export default ServicesPage;
