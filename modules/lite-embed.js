// core/lite-embed.js
/**
 * Lite Embed — self-hosted replacement for lite-youtube-embed and
 * lite-vimeo-embed. Registers two custom elements that render a lazy
 * facade (poster + play button). The real iframe is created only on
 * click, at which point the element is upgraded.
 *
 * DOM contract preserved from the libraries it replaces:
 *   <lite-youtube videoid="…" [params="…"] [playlabel="…"]>
 *   <lite-vimeo   videoid="…" [params="…"] [playlabel="…"]>
 *
 * The surrounding .lite-embed-wrapper / .lite-embed-caption markup is
 * produced by the messenger and posts serialization layers — this module
 * only handles the custom element internals.
 *
 * Companion styles live in modern-forum.css (see section 19).
 */
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // SHARED
  // -------------------------------------------------------------------------
  const PLAY_ICON_HTML =
    '<i class="fa-regular fa-circle-play" aria-hidden="true"></i>';

  function addPrefetch(kind, url) {
    const link = document.createElement('link');
    link.rel = kind;
    link.href = url;
    document.head.append(link);
  }

  // -------------------------------------------------------------------------
  // BASE CLASS
  // -------------------------------------------------------------------------
  class LiteEmbedBase extends HTMLElement {
    connectedCallback() {
      if (this._initialized) return;
      this._initialized = true;

      this.videoId = this.getAttribute('videoid');
      if (!this.videoId) return;

      this.playLabel = this.getAttribute('playlabel') || 'Play';

      // Play button — one instance, hidden on activation via CSS.
      let playBtn = this.querySelector('.lite-embed-playbtn');
      if (!playBtn) {
        playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'lite-embed-playbtn';
        playBtn.setAttribute('aria-label', this.playLabel);
        playBtn.innerHTML = PLAY_ICON_HTML;
        this.appendChild(playBtn);
      }
      this._playBtn = playBtn;

      // Poster image (subclass-specific: YouTube upgrade path vs Vimeo v2 API).
      this.setupPoster();

      // Indexable iframe inside <noscript>.
      this.addNoscriptIframe();

      // Warm TCP connections on first hover / focus.
      this.addEventListener('pointerover', this._handleWarm, { once: true, passive: true });
      this.addEventListener('focusin',     this._handleWarm, { once: true, passive: true });

      // Activate on click.
      this.addEventListener('click', this._handleActivate);
    }

    disconnectedCallback() {
      this.removeEventListener('click', this._handleActivate);
    }

    // ---- Overridable hooks --------------------------------------------------
    setupPoster() {}
    warmConnections() {}
    buildIframe() { return null; }

    // ---- Bound handlers -----------------------------------------------------
    _handleWarm = () => {
      try { this.warmConnections(); } catch (e) { /* warming is best-effort */ }
    };

    _handleActivate = () => {
      if (this.classList.contains('lite-activated')) return;
      const iframe = this.buildIframe();
      if (!iframe) return;
      this.classList.add('lite-activated');
      this.appendChild(iframe);
      iframe.focus();
    };

    // ---- Shared helpers -----------------------------------------------------
    getParams() {
      const params = new URLSearchParams(this.getAttribute('params') || '');
      if (!params.has('autoplay'))    params.append('autoplay', '1');
      if (!params.has('playsinline')) params.append('playsinline', '1');
      return params;
    }

    addNoscriptIframe() {
      if (this._noscriptAdded) return;
      this._noscriptAdded = true;
      const iframe = this.buildIframe();
      if (!iframe) return;
      const noscript = document.createElement('noscript');
      noscript.innerHTML = iframe.outerHTML;
      this.appendChild(noscript);
    }
  }

  // -------------------------------------------------------------------------
  // YOUTUBE
  // -------------------------------------------------------------------------
  class LiteYouTubeEmbed extends LiteEmbedBase {
    setupPoster() {
      if (this.style.backgroundImage) return;
      // First-paint poster: small, reliably available, no extra request.
      this.style.backgroundImage =
        'url("https://i.ytimg.com/vi/' + this.videoId + '/hqdefault.jpg")';
      this.upgradePosterImage();
    }

    upgradePosterImage() {
      // Deferred to avoid contending with critical network activity.
      setTimeout(() => {
        const webpUrl =
          'https://i.ytimg.com/vi_webp/' + this.videoId + '/sddefault.webp';
        const img = new Image();
        img.fetchPriority  = 'low';
        img.referrerPolicy = 'origin';
        img.onload = (e) => {
          // YouTube returns a 120×90 placeholder with a 200 status for
          // missing posters. Detect and discard.
          const isPlaceholder =
            e.target.naturalHeight === 90 && e.target.naturalWidth === 120;
          if (isPlaceholder) return;
          this.style.backgroundImage = 'url("' + webpUrl + '")';
        };
        img.src = webpUrl;
      }, 100);
    }

    warmConnections() {
      if (LiteYouTubeEmbed._preconnected) return;
      LiteYouTubeEmbed._preconnected = true;
      addPrefetch('preconnect', 'https://www.youtube-nocookie.com');
      addPrefetch('preconnect', 'https://www.google.com');
      addPrefetch('preconnect', 'https://googleads.g.doubleclick.net');
      addPrefetch('preconnect', 'https://static.doubleclick.net');
    }

    buildIframe() {
      const iframe = document.createElement('iframe');
      iframe.width  = '560';
      iframe.height = '315';
      iframe.title  = this.playLabel;
      iframe.allow =
        'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.src =
        'https://www.youtube-nocookie.com/embed/' +
        encodeURIComponent(this.videoId) +
        '?' + this.getParams().toString();
      return iframe;
    }
  }

  // -------------------------------------------------------------------------
  // VIMEO
  // -------------------------------------------------------------------------
  class LiteVimeoEmbed extends LiteEmbedBase {
    setupPoster() {
      if (this.style.backgroundImage) return;

      // Vimeo has no predictable poster URL — fetch thumbnail_large from the
      // v2 API and rewrite its size suffix to match the element's rendered
      // size at the current device pixel ratio.
      const rect = this.getBoundingClientRect();
      let targetW = rect.width  || 640;
      let targetH = rect.height || Math.round((targetW * 9) / 16);
      let dpr = window.devicePixelRatio || 1;
      if (dpr >= 2) dpr *= 0.75; // cap bandwidth on hi-DPI screens
      targetW = Math.round(targetW * dpr);
      targetH = Math.round(targetH * dpr);

      // Vimeo rounds thumbnails to /100 when the target isn't a multiple of 320.
      if (targetW % 320 !== 0) {
        const ratio = targetH / targetW;
        targetW = Math.ceil(targetW / 100) * 100;
        targetH = Math.round(targetW * ratio);
      }

      const self = this;
      fetch('https://vimeo.com/api/v2/video/' +
            encodeURIComponent(this.videoId) + '.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data[0] || !data[0].thumbnail_large) return;
          const thumb = data[0].thumbnail_large
            .replace(/-d_[\dx]+$/i, '-d_' + targetW + 'x' + targetH);
          self.style.backgroundImage = 'url("' + thumb + '")';
        })
        .catch(function () { /* poster is optional — silent fail */ });
    }

    warmConnections() {
      if (LiteVimeoEmbed._preconnected) return;
      LiteVimeoEmbed._preconnected = true;
      addPrefetch('preconnect', 'https://player.vimeo.com');
      addPrefetch('preconnect', 'https://i.vimeocdn.com');
      addPrefetch('preconnect', 'https://f.vimeocdn.com');
      addPrefetch('preconnect', 'https://fresnel.vimeocdn.com');
    }

    buildIframe() {
      const iframe = document.createElement('iframe');
      iframe.width  = '640';
      iframe.height = '360';
      iframe.title  = this.playLabel;
      iframe.allow =
        'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.src =
        'https://player.vimeo.com/video/' +
        encodeURIComponent(this.videoId) +
        '?' + this.getParams().toString();
      return iframe;
    }
  }

  // -------------------------------------------------------------------------
  // REGISTER
  // -------------------------------------------------------------------------
  if (window.customElements) {
    if (!customElements.get('lite-youtube')) {
      customElements.define('lite-youtube', LiteYouTubeEmbed);
    }
    if (!customElements.get('lite-vimeo')) {
      customElements.define('lite-vimeo', LiteVimeoEmbed);
    }
  }

  // -------------------------------------------------------------------------
  // EXPORT
  // -------------------------------------------------------------------------
  window.LiteEmbedModule = {
    version: '1.0.0',
    LiteEmbedBase: LiteEmbedBase,
    LiteYouTubeEmbed: LiteYouTubeEmbed,
    LiteVimeoEmbed: LiteVimeoEmbed
  };

  window.dispatchEvent(new CustomEvent('lite-embed-ready'));
})();
