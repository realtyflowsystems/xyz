CREATE TABLE public.chat_sessions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_key     uuid DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  visitor_name    text,
  visitor_email   text,
  status          text DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_seen_at    timestamptz DEFAULT now(),
  last_message_at timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE public.chat_messages (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid REFERENCES public.chat_sessions(id) ON DELETE CASCADE NOT NULL,
  sender     text NOT NULL CHECK (sender IN ('visitor','agent')),
  body       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_chat_messages_session_created ON public.chat_messages(session_id, created_at);
CREATE INDEX idx_chat_sessions_open_last ON public.chat_sessions(last_message_at DESC) WHERE status = 'open';

-- All access goes through Edge Functions with service_role — no direct client access
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
