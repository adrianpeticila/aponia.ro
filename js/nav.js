/**
 * APONIA.RO - Responsive Navigation Controller
 * Lightweight, zero dependencies, accessible (ESC key, aria-expanded).
 */
(function() {
  function initAponiaNav() {
    var toggleBtn = document.querySelector('.aponia-hamburger-btn');
    var drawer = document.querySelector('.aponia-mobile-drawer');

    if (!toggleBtn || !drawer) return;

    function toggleMenu(forceState) {
      var isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      var nextState = typeof forceState === 'boolean' ? forceState : !isExpanded;

      toggleBtn.setAttribute('aria-expanded', nextState ? 'true' : 'false');
      if (nextState) {
        drawer.classList.add('is-open');
      } else {
        drawer.classList.remove('is-open');
      }
    }

    toggleBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleMenu();
    });

    // Close on ESC key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        toggleMenu(false);
      }
    });

    // Close on click outside drawer
    document.addEventListener('click', function(e) {
      if (drawer.classList.contains('is-open')) {
        if (!drawer.contains(e.target) && !toggleBtn.contains(e.target)) {
          toggleMenu(false);
        }
      }
    });

    // Close drawer when a link inside is clicked
    var links = drawer.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function() {
        toggleMenu(false);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAponiaNav);
  } else {
    initAponiaNav();
  }
})();
