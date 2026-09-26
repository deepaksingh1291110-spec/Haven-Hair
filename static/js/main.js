// ============================================================
// Haven Hair — js/main.js
// Handles: navbar scroll effect, mobile nav toggle,
//          feature tab switching, scroll-reveal animation.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

    // ---- Navbar: add .scrolled class after 60px scroll ----
    const navbar = document.getElementById('navbar');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 60) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }, { passive: true });


    // ---- Mobile nav toggle --------------------------------
    const navToggle = document.getElementById('nav-toggle');
    const navLinks  = document.getElementById('nav-links');

    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('open');
    });

    // Close nav when any link is tapped
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => navLinks.classList.remove('open'));
    });


    // ---- Feature tabs -------------------------------------
    // Buttons:  .tab-btn with data-tab="customer" or "owner"
    // Panels:   .features-grid with id="tab-customer" or "tab-owner"

    const tabBtns   = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.features-grid');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;   // "customer" or "owner"

            // Swap active button
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Swap active panel
            tabPanels.forEach(panel => {
                panel.classList.remove('active');
                if (panel.id === `tab-${target}`) {
                    panel.classList.add('active');
                }
            });
        });
    });


    // ---- Scroll reveal ------------------------------------
    // Elements to animate in on scroll
    const revealTargets = document.querySelectorAll(
        '.step-card, .feat-card, .phil-card, .cta-card, .section-header'
    );

    // Add .reveal class (opacity:0, translateY) to each target
    revealTargets.forEach(el => el.classList.add('reveal'));

    // IntersectionObserver watches each target and adds .visible when in view
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                // Stagger delay for cards that appear together
                const delay = (index % 6) * 65;
                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, delay);
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.10 });

    revealTargets.forEach(el => revealObserver.observe(el));

});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/sw.js')
            .then(() => console.log('SW registered'))
            .catch(err => console.log('SW failed:', err));
    });
}
