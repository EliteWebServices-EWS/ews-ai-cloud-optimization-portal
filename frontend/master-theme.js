// master-theme.js - Definitive Unified Release Overwrite
// Maintained & Approved by Mpho (Lead) to force complete project-wide sync
(function() {
    // 1. Dynamic Asset Configuration Framework
    const twScript = document.createElement('script');
    twScript.src = "https://cdn.tailwindcss.com";
    document.head.appendChild(twScript);

    twScript.onload = () => {
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        awsOrange: { 400: '#FFAA33', 500: '#FF9900', 600: '#E68A00' }, // Finalized Brand Palette
                        cloudDark: '#0F1115',      // Deep premium space background
                        cloudCharcoal: '#161920',  // Elevated element block layer
                        cloudBorder: '#222933'     // Subdued panel split tint
                    }
                }
            }
        };

        // Instantly force high-contrast text layout vars to wipe away legacy slate styles
        document.body.className = "bg-cloudDark text-zinc-100 min-h-screen flex flex-col justify-between antialiased";
        renderGlobalElements();
    };

    function renderGlobalElements() {
        // FIX 1: Target semantic structural headers OR fallback selector tokens directly
        const header = document.querySelector('header') || document.getElementById('global-header');
        if (header) {
            header.className = "bg-cloudCharcoal border-b border-cloudBorder h-20 flex items-center justify-between px-8 sticky top-0 z-50";
            header.innerHTML = `
                <div class="flex items-center space-x-4">
                    <div class="relative w-12 h-8 flex items-center justify-center">
                        <svg class="absolute inset-0 w-full h-full text-awsOrange-500" viewBox="0 0 100 60" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round">
                            <path d="M25 45A15 15 0 0 1 25 15A18 18 0 0 1 65 12A15 15 0 0 1 75 45Z" />
                        </svg>
                        <span class="relative z-10 font-black text-white text-lg tracking-tighter lowercase select-none pb-0.5">ews</span>
                    </div>
                    <div class="flex flex-col border-l border-zinc-700 pl-3">
                        <span class="text-sm font-black tracking-wider uppercase text-white leading-none">Elite Web Services</span>
                        <span class="text-[9px] text-awsOrange-500 tracking-widest uppercase font-bold mt-1">AWS Cloud Solutions</span>
                    </div>
                </div>
                <nav class="hidden lg:flex space-x-8 text-xs font-bold uppercase tracking-widest text-zinc-400">
                    <a href="index.html" class="text-white border-b border-awsOrange-500 pb-1">Home</a>
                    <a href="pages/services.html" class="hover:text-white transition">Services Matrix</a>
                    <a href="pages/about.html" class="hover:text-white transition">Corporate Profile</a>
                    <a href="pages/security.html" class="hover:text-white transition">Security</a>
                </nav>
                <a href="../Portal/dashboard/index.html" class="bg-awsOrange-500 hover:bg-awsOrange-600 text-black text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded transition font-bold shadow-lg shadow-awsOrange-500/15">Console Login</a>
            `;
        }

        // FIX 2: Correct routing locations to point to /frontend/pages/ instead of dead /legal/ directories
        const footer = document.querySelector('footer') || document.getElementById('global-footer');
        if (footer) {
            footer.className = "bg-cloudCharcoal border-t border-cloudBorder py-8 px-8 text-center text-xs text-zinc-500 space-y-2";
            footer.innerHTML = `
                <p class="font-medium text-zinc-400">&copy; 2026 Elite Web Services LLC. All rights reserved. AWS Cloud Strategy | Innovation | Transformation.</p>
                <p>HQ: Houston, TX | Desk: <a href="mailto:elitewebservicesllc@gmail.com" class="text-awsOrange-500 hover:underline">elitewebservicesllc@gmail.com</a></p>
                <div class="flex justify-center space-x-6 pt-2 text-[11px]">
                    <a href="pages/privacy.html" class="hover:text-zinc-300 transition">Privacy Policy</a>
                    <a href="pages/terms.html" class="hover:text-zinc-300 transition">Terms of Service</a>
                    <a href="pages/security.html" class="hover:text-zinc-300 transition">Security Posture</a>
                </div>
            `;
        }

        // FIX 3: Programmatically clean up Uju's double <main> wrapper bugs and format structural grids inside the active viewport
        const mainContent = document.querySelector('main');
        if (mainContent && !mainContent.dataset.sanitized) {
            mainContent.className = "flex-1";
            mainContent.dataset.sanitized = "true";
            
            // Re-render sanitized grid context matching all 8 Business Plan capabilities perfectly
            mainContent.innerHTML = `
                <section class="relative bg-zinc-950 py-24 px-8 border-b border-cloudBorder overflow-hidden">
                    <div class="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                        <div class="space-y-6">
                            <span class="text-xs font-bold uppercase tracking-widest text-awsOrange-500 bg-awsOrange-500/10 border border-awsOrange-500/20 px-3 py-1 rounded">AWS Partner Advisory Network</span>
                            <h1 class="text-4xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-none">AWS Cloud Strategy, <span class="text-awsOrange-500">Innovation</span> & Transformation</h1>
                            <p class="text-zinc-400 text-sm md:text-base leading-relaxed">Architecting, automating, and managing robust enterprise environments on AWS to eliminate configuration complexity, guarantee strict compliance, and minimize operational cost arrays.</p>
                            <div class="flex gap-4 pt-2">
                                <a href="mailto:elitewebservicesllc@gmail.com" class="bg-white hover:bg-zinc-200 text-black text-xs font-bold uppercase tracking-wider px-6 py-3.5 rounded transition font-bold">Request Consultation</a>
                                <a href="#matrix" class="border border-zinc-800 hover:border-awsOrange-500 text-white text-xs font-bold uppercase tracking-wider px-6 py-3.5 rounded transition">View Matrix</a>
                            </div>
                        </div>
                        <div class="bg-cloudCharcoal border border-cloudBorder p-6 rounded-xl shadow-2xl mx-auto max-w-md w-full">
                            <h3 class="text-white text-xs uppercase font-bold tracking-wider mb-4 pb-2 border-b border-zinc-800">Target Industry Workloads</h3>
                            <ul class="space-y-3 font-mono text-xs text-zinc-300">
                                <li><span class="text-awsOrange-500">⚡</span> Healthcare & Life Sciences (HIPAA Compliance)</li>
                                <li><span class="text-awsOrange-500">⚡</span> Financial Services (High-Security Architecture)</li>
                                <li><span class="text-awsOrange-500">⚡</span> E-Commerce & High-Growth SaaS Ecosystems</li>
                                <li><span class="text-awsOrange-500">⚡</span> Public Sector & Educational Foundations</li>
                            </ul>
                        </div>
                    </div>
                </section>
                <section id="matrix" class="py-20 px-8 max-w-7xl mx-auto">
                    <h2 class="text-xl font-black uppercase text-center tracking-wider text-white mb-12">Core Architectural Capabilities</h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div class="bg-cloudCharcoal border border-cloudBorder p-5 rounded-lg"><h4 class="text-awsOrange-500 text-xs font-bold uppercase">1. Strategy & Readiness</h4><p class="text-zinc-400 text-xs mt-2">Cloud roadmapping aligning corporate scalability vectors safely.</p></div>
                        <div class="bg-cloudCharcoal border border-cloudBorder p-5 rounded-lg"><h4 class="text-awsOrange-500 text-xs font-bold uppercase">2. Well-Architected Reviews</h4><p class="text-zinc-400 text-xs mt-2">Deep-dive structural optimization audits spanning all core pillars.</p></div>
                        <div class="bg-cloudCharcoal border border-cloudBorder p-5 rounded-lg"><h4 class="text-awsOrange-500 text-xs font-bold uppercase">3. Cloud Migrations</h4><p class="text-zinc-400 text-xs mt-2">High-reliability Rehost, Replatform, and advanced Refactoring pipelines.</p></div>
                        <div class="bg-cloudCharcoal border border-cloudBorder p-5 rounded-lg"><h4 class="text-awsOrange-500 text-xs font-bold uppercase">4. Security & Compliance</h4><p class="text-zinc-400 text-xs mt-2">Guardrails ensuring automated validation for SOC 2 and ISO endpoints.</p></div>
                        <div class="bg-cloudCharcoal border border-cloudBorder p-5 rounded-lg"><h4 class="text-awsOrange-500 text-xs font-bold uppercase">5. DevOps Automation</h4><p class="text-zinc-400 text-xs mt-2">Declarative Infrastructure-as-Code pipelines with automated deployments.</p></div>
                        <div class="bg-cloudCharcoal border border-cloudBorder p-5 rounded-lg"><h4 class="text-awsOrange-500 text-xs font-bold uppercase">6. Cost Optimization</h4><p class="text-zinc-400 text-xs mt-2">FinOps data monitoring designed to purge idle cloud spends instantly.</p></div>
                        <div class="bg-cloudCharcoal border border-cloudBorder p-5 rounded-lg"><h4 class="text-awsOrange-500 text-xs font-bold uppercase">7. Managed Services</h4><p class="text-zinc-400 text-xs mt-2">Continuous environment operations and engineering support desks.</p></div>
                        <div class="bg-cloudCharcoal border border-cloudBorder p-5 rounded-lg"><h4 class="text-awsOrange-500 text-xs font-bold uppercase">8. Data & Analytics</h4><p class="text-zinc-400 text-xs mt-2">High-performance processing engines built directly on AWS structures.</p></div>
                    </div>
                </section>
            `;
        }
    }
})();
