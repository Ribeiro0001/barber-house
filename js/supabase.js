const SUPABASE_URL = "https://sutkrpiuqgrkpdijrgzj.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_dN3Yba9zPkrN9DBrrxaJ4Q_F-x_8PbY";

const clienteSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
);
