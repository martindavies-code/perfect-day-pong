/** Optional local-device speech. No remote voice, service or audio download. */
export function createScoreAnnouncer(getSettings, isMuted, env = globalThis) {
  const synth = env.speechSynthesis;
  let enabledByGesture = false;
  let failed = false;
  let voice = null;
  function refreshVoices() {
    try {
      const voices = synth?.getVoices?.() || [];
      // Prefer an installed English voice. Never silently use a network voice.
      voice = voices.find(v => v.localService && /^en-GB/i.test(v.lang))
        || voices.find(v => v.localService && /^en/i.test(v.lang)) || null;
    } catch { voice = null; }
  }
  synth?.addEventListener?.('voiceschanged', refreshVoices);
  refreshVoices();
  function cancel() { try { synth?.cancel(); } catch {} }
  function onVisibility() { if (env.document?.hidden) cancel(); }
  env.document?.addEventListener?.('visibilitychange', onVisibility);
  function unlock() { enabledByGesture = true; refreshVoices(); }
  function say(text) {
    cancel();
    refreshVoices();
    const st = getSettings();
    if (!enabledByGesture || failed || !voice || !env.SpeechSynthesisUtterance || st.announcerEnabled === false || isMuted() || st.masterVolume <= 0 || st.sfxVolume <= 0) return false;
    try {
      const line = new env.SpeechSynthesisUtterance(text);
      line.voice = voice;
      line.lang = voice.lang;
      line.pitch = 0.55;
      line.rate = 1.1;
      line.volume = Math.max(0, Math.min(1, st.masterVolume * st.sfxVolume));
      line.onerror = event => { if (!['canceled', 'interrupted'].includes(event.error)) failed = true; };
      synth.speak(line);
      return true;
    } catch { failed = true; return false; }
  }
  function status() {
    if (getSettings().announcerEnabled === false) return 'Voice off. Score calls remain on screen.';
    if (!synth || !env.SpeechSynthesisUtterance || failed || !voice) return 'No working installed English voice. Score calls are shown on screen.';
    return 'Low-pitched synthetic score calls, using an installed English voice. Sound varies by device. Calls stop when you serve; play never waits for speech.';
  }
  return { say, cancel, unlock, status, destroy() { cancel(); env.document?.removeEventListener?.('visibilitychange', onVisibility); synth?.removeEventListener?.('voiceschanged', refreshVoices); } };
}
