(() => {
  const measurementId = String(window.RUNBI_ANALYTICS_ID || '').trim();
  const canUseGa4 = /^G-[A-Z0-9]+$/i.test(measurementId);

  if (canUseGa4) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', measurementId, { anonymize_ip: true });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }

  const track = (event, params = {}) => {
    if (typeof window.gtag === 'function') window.gtag('event', event, params);
    window.dispatchEvent(new CustomEvent('runbi:analytics', { detail: { event, ...params, at: Date.now() } }));
  };
  window.runbiTrack = track;

  document.querySelectorAll('[data-track]').forEach((element) => {
    element.addEventListener('click', () => track(element.dataset.track, {
      placement: element.closest('section')?.id || 'unknown',
      link_url: element.href || undefined
    }));
  });

  document.querySelectorAll('details').forEach((element) => {
    element.addEventListener('toggle', () => {
      if (element.open) track('faq_open', { question: element.querySelector('summary')?.textContent?.trim() });
    });
  });

  document.querySelectorAll('video').forEach((video) => {
    const sent = new Set();
    const videoName = video.getAttribute('aria-label') || 'product_preview';
    const sendOnce = (event, params = {}) => {
      if (sent.has(event)) return;
      sent.add(event);
      track(event, { video_name: videoName, ...params });
    };
    video.addEventListener('play', () => sendOnce('video_start'));
    video.addEventListener('timeupdate', () => {
      if (!video.duration) return;
      const progress = video.currentTime / video.duration;
      [25, 50, 75].forEach((milestone) => {
        if (progress >= milestone / 100) sendOnce(`video_${milestone}_percent`, { progress: milestone });
      });
    });
    video.addEventListener('ended', () => sendOnce('video_complete', { progress: 100 }));
  });
})();
