// master-theme.js - Maintained by Florence
(function() {
    // 1. Inject Tailwind and custom fonts dynamically
    const twScript = document.createElement('script');
    twScript.src = "https://cdn.tailwindcss.com";
    document.head.appendChild(twScript);

    twScript.onload = () => {
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        awsOrange: { 400: '#FFAA33', 500: '#FF9900', 600: '#E68A00' },
                        cloudDark: '#0F1115',
                        cloudCharcoal: '#161920',
                        cloudBorder: '#222933'
                    }
                }
            }
        };

        // Apply baseline layout variables instantly
        document.body.className = "bg-cloudDark text-zinc-100 min-h-screen flex flex-col justify-between antialiased";
        renderGlobalElements();
    };

    function renderGlobalElements() {
        // Enforce the official lowercase "ews" cloud header logo matching Screenshot 2026-06-26 160053.png
        const header = document.getElementById('global-header');
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
                    <a href="/frontend/index.html" class="hover:text-white transition">Home</a>
                    <a href="/frontend/pages/services.html" class="hover:text-white transition">Services Matrix</a>
                    <a href="/frontend/pages/about.html" class="hover:text-white transition">Corporate Profile</a>
                    <a href="/legal/security.html" class="hover:text-white transition">Security</a>
                </nav>
                <a href="/Portal/dashboard/index.html" class="bg-awsOrange-500 hover:bg-awsOrange-600 text-black text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded transition font-bold">Console Login</a>
            `;
        }

        // Enforce centralized Business Plan legal variables and corporate email
        const footer = document.getElementById('global-footer');
        if (footer) {
            footer.className = "bg-cloudCharcoal border-t border-cloudBorder py-8 px-8 text-center text-xs text-zinc-500 space-y-2";
            footer.innerHTML = `
                <p class="font-medium text-zinc-400">&copy; 2026 Elite Web Services LLC. All rights reserved. AWS Cloud Strategy | Innovation | Transformation.</p>
                <p>HQ: Houston, TX | Global Remote Desk: <a href="mailto:elitewebservicesllc@gmail.com" class="text-awsOrange-500 hover:underline">elitewebservicesllc@gmail.com</a></p>
                <div class="flex justify-center space-x-6 pt-2 text-[11px]">
                    <a href="/legal/privacy.html" class="hover:text-zinc-300">Privacy Policy</a>
                    <a href="/legal/terms.html" class="hover:text-zinc-300">Terms of Service</a>
                    <a href="/legal/security.html" class="hover:text-zinc-300">Security Posture</a>
                </div>
            `;
        }
    }
})();
