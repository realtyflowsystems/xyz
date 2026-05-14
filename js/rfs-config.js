// RealtyFlow Systems — Supabase Client Configuration
// Replace the placeholder values below after creating your Supabase project.
// Dashboard → Settings → API → copy Project URL and anon/public key.

const RFS = {
  supabaseUrl:  'https://YOUR_PROJECT_ID.supabase.co',
  supabaseKey:  'YOUR_SUPABASE_ANON_KEY',

  // Booking endpoint (same as supabaseUrl + /functions/v1/booking-create)
  bookingEndpoint() {
    return `${this.supabaseUrl}/functions/v1/booking-create`;
  },

  // Initialize Supabase JS client (loaded from CDN in pages that need it)
  // Usage: const sb = RFS.client();
  client() {
    if (!window.supabase) {
      console.error('Supabase JS not loaded. Add the CDN script before this file.');
      return null;
    }
    return window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
  },
};
