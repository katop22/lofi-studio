// Common contract every SNS channel plugin implements.
// A channel is a small, self-describing object; sns.js holds the registry.

export const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

export class Channel {
  /**
   * @param spec {
   *   key, label,
   *   mediaKind: 'landscape' | 'vertical' | 'link',   // asset this channel needs
   *   captionStyle: 'video' | 'text',                  // which caption variant
   *   priority: number,            // lower posts first (canonical-URL sources go first)
   *   enableKey: string,           // env flag, e.g. 'YOUTUBE_ENABLE'
   *   requiredEnv: string[],       // credential env keys
   *   providesCanonicalUrl: bool,  // its result URL can be linked by text channels
   *   implemented: bool,           // false => stub (post() throws until wired)
   *   post?: async (ctx) => ({ url, id, evidence })
   * }
   */
  constructor(spec) {
    Object.assign(
      this,
      {
        mediaKind: 'landscape',
        captionStyle: 'video',
        priority: 50,
        requiredEnv: [],
        enableKey: null,
        providesCanonicalUrl: false,
        implemented: false,
      },
      spec
    );
  }

  enableFlagKey() {
    return this.enableKey || `${this.key.toUpperCase()}_ENABLE`;
  }

  /** Is the ENABLE flag switched on in env? */
  enabledFlag(env) {
    return truthy(env[this.enableFlagKey()]);
  }

  /** Credential keys that are missing/empty. */
  missingCreds(env) {
    return this.requiredEnv.filter((k) => !env[k] || !String(env[k]).trim());
  }

  isConfigured(env) {
    return this.missingCreds(env).length === 0;
  }

  /** Default post() — stubs inherit this and fail loudly until wired. */
  async post() {
    throw new Error(
      `Channel "${this.key}" is scaffolded but not wired yet. ` +
        'Add the real API implementation in src/channels/ to activate it.'
    );
  }
}
