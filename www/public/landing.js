(function () {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Theme handling
  const html = document.documentElement;
  const stored = localStorage.getItem("gridline-theme");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  function applyTheme(theme) {
    if (theme === "light") {
      html.classList.add("light");
      html.removeAttribute("data-theme-auto");
    } else if (theme === "dark") {
      html.classList.remove("light");
      html.removeAttribute("data-theme-auto");
    } else {
      // auto
      html.classList.toggle("light", !systemDark && window.matchMedia("(prefers-color-scheme: light)").matches);
      html.setAttribute("data-theme-auto", "");
    }
    updateToggleIcon();
  }

  function updateToggleIcon() {
    const suns = document.querySelectorAll(".theme-icon-sun");
    const moons = document.querySelectorAll(".theme-icon-moon");
    const isLight = html.classList.contains("light");
    suns.forEach((el) => el.classList.toggle("hidden", !isLight));
    moons.forEach((el) => el.classList.toggle("hidden", isLight));
  }

  applyTheme(stored);

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const isLight = html.classList.contains("light");
    const next = isLight ? "dark" : "light";
    localStorage.setItem("gridline-theme", next);
    applyTheme(next);
  });

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (html.hasAttribute("data-theme-auto")) {
        applyTheme("auto");
      }
    });

  // OS-aware download button
  const downloadBtn = document.querySelector("a[data-download]");
  if (downloadBtn) {
    const platform = navigator.platform || "";
    const userAgent = navigator.userAgent || "";
    const isMac = /Mac/i.test(platform) && !/iPhone|iPad/i.test(userAgent);
    const isWin = /Win/i.test(platform);
    const isLinux = /Linux/i.test(platform) && !/Android/i.test(userAgent);

    const releasesUrl = "https://github.com/AdrianBonpin/gridline/releases";
    const version = "0.7.10";

    if (isMac) {
      downloadBtn.textContent = "Download for macOS";
      downloadBtn.href = `${releasesUrl}/download/v${version}/Gridline_${version}_aarch64.dmg`;
      document.getElementById("macos-hint")?.classList.remove("hidden");
    } else if (isWin) {
      downloadBtn.textContent = "Download for Windows";
      downloadBtn.href = `${releasesUrl}/download/v${version}/Gridline_${version}_x64-setup.exe`;
    } else if (isLinux) {
      downloadBtn.textContent = "Download for Linux";
      downloadBtn.href = `${releasesUrl}/download/v${version}/Gridline-${version}-1.x86_64.rpm`;
    } else {
      downloadBtn.textContent = "Download";
      downloadBtn.href = releasesUrl;
    }
  }

  document.getElementById("copy-quarantine")?.addEventListener("click", async () => {
    const command = "sudo xattr -dr com.apple.quarantine /Applications/Gridline.app";
    try {
      await navigator.clipboard.writeText(command);
      const btn = document.getElementById("copy-quarantine");
      if (!btn) return;
      const original = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = original), 1500);
    } catch {}
  });

  // Nav scroll background
  const nav = document.getElementById("nav");
  function onScroll() {
    if (!nav) return;
    if (window.scrollY > 40) {
      nav.classList.add("bg-[var(--surface)]", "backdrop-blur-md", "border-b", "border-[var(--border)]");
    } else {
      nav.classList.remove("bg-[var(--surface)]", "backdrop-blur-md", "border-b", "border-[var(--border)]");
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Anime.js animations
  let anime;
  try {
    anime = require ? null : window.anime;
  } catch {}

  function loadAnime(callback) {
    if (window.anime) {
      callback(window.anime);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js";
    script.onload = () => callback(window.anime);
    document.head.appendChild(script);
  }

  loadAnime((anime) => {
    // Hero entrance
    const hero = document.getElementById("hero");
    if (hero) {
      const eyebrow = hero.querySelector(".hero-animate > .font-mono");
      const h1 = hero.querySelector("h1");
      const subtitle = hero.querySelector(".hero-animate > p:nth-of-type(2)");
      const buttons = hero.querySelector(".hero-animate > div");
      const screenshot = hero.querySelector(".hero-screenshot");

      const heroTl = anime.timeline({ easing: "easeOutExpo" });

      if (!reducedMotion) {
        anime.set([eyebrow, h1, subtitle, buttons, screenshot], { opacity: 0, translateY: 20 });
        anime.set(screenshot, { opacity: 0, scale: 0.96, translateY: 0 });

        if (eyebrow) heroTl.add({ targets: eyebrow, opacity: [0, 1], translateY: [15, 0] }, 0);
        if (h1) heroTl.add({ targets: h1, opacity: [0, 1], translateY: [30, 0], duration: 800 }, 100);
        if (subtitle) heroTl.add({ targets: subtitle, opacity: [0, 1], translateY: [20, 0] }, 250);
        if (buttons) heroTl.add({ targets: buttons, opacity: [0, 1], translateY: [20, 0] }, 350);
        if (screenshot) heroTl.add({ targets: screenshot, opacity: [0, 1], scale: [0.96, 1], duration: 900 }, 450);
      }
    }

    // Section scroll reveals
    const sections = document.querySelectorAll(".section-animate");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const children = entry.target.children;
          if (reducedMotion) {
            anime({ targets: children, opacity: [0, 1], duration: 400, easing: "linear" });
          } else {
            anime({
              targets: children,
              opacity: [0, 1],
              translateY: [40, 0],
              duration: 700,
              delay: anime.stagger(100),
              easing: "easeOutCubic",
            });
          }
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15 }
    );
    sections.forEach((section) => observer.observe(section));
  });

  // FAQ smooth height animation via native details toggle + anime fallback
  document.querySelectorAll(".faq-item").forEach((item) => {
    const summary = item.querySelector(".faq-summary");
    const body = item.querySelector(".faq-body");
    if (!summary || !body) return;

    summary.addEventListener("click", (e) => {
      e.preventDefault();
      const isOpen = item.hasAttribute("open");
      if (isOpen) {
        if (window.anime && !reducedMotion) {
          window.anime({
            targets: body,
            height: [body.scrollHeight, 0],
            opacity: [1, 0],
            duration: 250,
            easing: "easeInQuad",
            complete: () => item.removeAttribute("open"),
          });
        } else {
          item.removeAttribute("open");
        }
      } else {
        item.setAttribute("open", "");
        if (window.anime && !reducedMotion) {
          window.anime({
            targets: body,
            height: [0, body.scrollHeight],
            opacity: [0, 1],
            duration: 300,
            easing: "easeOutQuad",
          });
        }
      }
    });
  });
})();
