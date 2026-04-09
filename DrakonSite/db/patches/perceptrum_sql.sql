--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.5

-- Started on 2026-02-18 21:09:10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 217 (class 1259 OID 42790)
-- Name: active_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.active_cards (
    id integer NOT NULL,
    user_id text NOT NULL,
    stripe_customer_id text NOT NULL,
    stripe_payment_method_id text NOT NULL,
    brand text,
    last4 text,
    exp_month integer,
    exp_year integer,
    is_default integer DEFAULT 1 NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);


ALTER TABLE public.active_cards OWNER TO postgres;

--
-- TOC entry 218 (class 1259 OID 42796)
-- Name: active_cards_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.active_cards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.active_cards_id_seq OWNER TO postgres;

--
-- TOC entry 5475 (class 0 OID 0)
-- Dependencies: 218
-- Name: active_cards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.active_cards_id_seq OWNED BY public.active_cards.id;


--
-- TOC entry 219 (class 1259 OID 42797)
-- Name: app_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_users (
    id text NOT NULL,
    email text,
    auth_provider text NOT NULL,
    country_code text,
    locale text,
    handle text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.app_users OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 42804)
-- Name: camera_algorithms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.camera_algorithms (
    id integer NOT NULL,
    camera_id integer NOT NULL,
    algorithm_type text NOT NULL,
    is_enabled integer DEFAULT 1,
    llm_prompt text,
    image_region text,
    config_json text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.camera_algorithms OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 42812)
-- Name: camera_algorithms_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.camera_algorithms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.camera_algorithms_id_seq OWNER TO postgres;

--
-- TOC entry 5476 (class 0 OID 0)
-- Dependencies: 221
-- Name: camera_algorithms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.camera_algorithms_id_seq OWNED BY public.camera_algorithms.id;


--
-- TOC entry 222 (class 1259 OID 42813)
-- Name: cameras; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cameras (
    id integer NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    ip_address text NOT NULL,
    rtsp_port text,
    manufacturer text,
    username text,
    password text,
    connection_method text,
    is_online integer DEFAULT 0,
    is_service_running integer DEFAULT 0,
    thumbnail_url text,
    last_thumbnail_update timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    store_frames integer DEFAULT 0 NOT NULL,
    retention_days integer,
    description text,
    street text,
    number text,
    neighborhood text,
    city text,
    state text,
    zip_code text,
    complement text,
    country text,
    timezone text,
    utc_offset_seconds integer,
    webcam_index integer,
    allowpublicaccess integer DEFAULT 0 NOT NULL,
    analysis_speed integer DEFAULT 3,
    model_tier text DEFAULT 'plus'::text,
    channel text,
    subtype text
);


ALTER TABLE public.cameras OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 42826)
-- Name: cameras_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cameras_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cameras_id_seq OWNER TO postgres;

--
-- TOC entry 5477 (class 0 OID 0)
-- Dependencies: 223
-- Name: cameras_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cameras_id_seq OWNED BY public.cameras.id;


--
-- TOC entry 224 (class 1259 OID 42827)
-- Name: chat_hit_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_hit_images (
    id integer NOT NULL,
    user_id text NOT NULL,
    chat_session_id integer NOT NULL,
    camera_id integer NOT NULL,
    r2_key text NOT NULL,
    time_in_video text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    media_type text DEFAULT 'image'::text NOT NULL,
    mime_type text
);


ALTER TABLE public.chat_hit_images OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 42834)
-- Name: chat_hit_images_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.chat_hit_images ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.chat_hit_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 226 (class 1259 OID 42835)
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    camera_ids text,
    tokens_used integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    session_id integer,
    message_type text DEFAULT 'final'::text,
    is_pending integer DEFAULT 0,
    model_prompt_tokens integer DEFAULT 0,
    model_output_tokens integer DEFAULT 0,
    model_total_tokens integer DEFAULT 0,
    camera_selection_json text,
    uploaded_image_base64 text,
    usage_recorded_at text
);


ALTER TABLE public.chat_messages OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 42848)
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_messages_id_seq OWNER TO postgres;

--
-- TOC entry 5478 (class 0 OID 0)
-- Dependencies: 227
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- TOC entry 228 (class 1259 OID 42849)
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_sessions (
    id integer NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.chat_sessions OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 42856)
-- Name: chat_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_sessions_id_seq OWNER TO postgres;

--
-- TOC entry 5479 (class 0 OID 0)
-- Dependencies: 229
-- Name: chat_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_sessions_id_seq OWNED BY public.chat_sessions.id;


--
-- TOC entry 230 (class 1259 OID 42857)
-- Name: commands; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.commands (
    id integer NOT NULL,
    user_id text NOT NULL,
    camera_id integer,
    command_type text NOT NULL,
    payload text NOT NULL,
    status text DEFAULT 'pending'::text,
    result text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.commands OWNER TO postgres;

--
-- TOC entry 231 (class 1259 OID 42865)
-- Name: commands_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.commands_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.commands_id_seq OWNER TO postgres;

--
-- TOC entry 5480 (class 0 OID 0)
-- Dependencies: 231
-- Name: commands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.commands_id_seq OWNED BY public.commands.id;


--
-- TOC entry 232 (class 1259 OID 42866)
-- Name: cron_locks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cron_locks (
    name text NOT NULL,
    locked_until_utc text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.cron_locks OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 42873)
-- Name: detections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.detections (
    id integer NOT NULL,
    user_id text NOT NULL,
    camera_id integer NOT NULL,
    camera_name text NOT NULL,
    algo_type text NOT NULL,
    detected_at timestamp without time zone NOT NULL,
    image_key text NOT NULL,
    event_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    video_key text,
    media_type text DEFAULT 'image'::text
);


ALTER TABLE public.detections OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 42880)
-- Name: detections_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.detections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.detections_id_seq OWNER TO postgres;

--
-- TOC entry 5481 (class 0 OID 0)
-- Dependencies: 234
-- Name: detections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.detections_id_seq OWNED BY public.detections.id;


--
-- TOC entry 235 (class 1259 OID 42881)
-- Name: events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.events (
    id integer NOT NULL,
    user_id text NOT NULL,
    camera_id integer,
    event_type text NOT NULL,
    description text,
    metadata text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    message text,
    details_json text,
    is_unread integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.events OWNER TO postgres;

--
-- TOC entry 236 (class 1259 OID 42889)
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.events_id_seq OWNER TO postgres;

--
-- TOC entry 5482 (class 0 OID 0)
-- Dependencies: 236
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- TOC entry 237 (class 1259 OID 42890)
-- Name: exe_pairings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exe_pairings (
    user_id text NOT NULL,
    client_id text NOT NULL,
    exe_id text NOT NULL,
    exe_token_hash text NOT NULL,
    paired_at text NOT NULL,
    last_seen_at text,
    status text DEFAULT 'connected'::text NOT NULL
);


ALTER TABLE public.exe_pairings OWNER TO postgres;

--
-- TOC entry 238 (class 1259 OID 42896)
-- Name: faceid_targets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.faceid_targets (
    id integer NOT NULL,
    camera_id integer NOT NULL,
    person_name text NOT NULL,
    person_description text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    image_url text
);


ALTER TABLE public.faceid_targets OWNER TO postgres;

--
-- TOC entry 239 (class 1259 OID 42903)
-- Name: faceid_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.faceid_targets ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.faceid_targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 240 (class 1259 OID 42904)
-- Name: job_run_alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_run_alerts (
    id integer NOT NULL,
    run_id integer NOT NULL,
    result_id integer,
    alert_rule_id integer NOT NULL,
    message text NOT NULL,
    channel text NOT NULL,
    sent_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_run_alerts OWNER TO postgres;

--
-- TOC entry 241 (class 1259 OID 42910)
-- Name: job_run_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_run_alerts ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_run_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 242 (class 1259 OID 42911)
-- Name: job_runtime_states; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_runtime_states (
    job_id integer NOT NULL,
    user_id text NOT NULL,
    job_name text,
    status text NOT NULL,
    started_at_utc text,
    stopped_at_utc text,
    last_event_at_utc text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_runtime_states OWNER TO postgres;

--
-- TOC entry 243 (class 1259 OID 42918)
-- Name: job_schedule_days; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_schedule_days (
    id integer NOT NULL,
    job_id integer NOT NULL,
    schedule_mode text NOT NULL,
    day_name text NOT NULL,
    day_of_week integer,
    day_of_month integer,
    month_of_year integer,
    sort_order integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_schedule_days OWNER TO postgres;

--
-- TOC entry 244 (class 1259 OID 42925)
-- Name: job_schedule_days_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_schedule_days ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_schedule_days_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 245 (class 1259 OID 42926)
-- Name: job_schedule_fires; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_schedule_fires (
    id integer NOT NULL,
    fire_key text NOT NULL,
    job_id integer NOT NULL,
    schedule_day_id integer NOT NULL,
    window_id integer NOT NULL,
    local_date text NOT NULL,
    start_time text NOT NULL,
    triggered_at_utc text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_schedule_fires OWNER TO postgres;

--
-- TOC entry 246 (class 1259 OID 42933)
-- Name: job_schedule_fires_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_schedule_fires ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_schedule_fires_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 247 (class 1259 OID 42934)
-- Name: job_schedule_stops; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_schedule_stops (
    id integer NOT NULL,
    stop_key text NOT NULL,
    job_id integer NOT NULL,
    schedule_day_id integer NOT NULL,
    window_id integer NOT NULL,
    local_date text NOT NULL,
    end_time text NOT NULL,
    triggered_at_utc text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_schedule_stops OWNER TO postgres;

--
-- TOC entry 248 (class 1259 OID 42941)
-- Name: job_schedule_stops_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_schedule_stops ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_schedule_stops_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 249 (class 1259 OID 42942)
-- Name: job_schedule_windows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_schedule_windows (
    id integer NOT NULL,
    job_id integer NOT NULL,
    schedule_day_id integer NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    is_enabled integer DEFAULT 1 NOT NULL,
    sort_order integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_schedule_windows OWNER TO postgres;

--
-- TOC entry 250 (class 1259 OID 42950)
-- Name: job_schedule_windows_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_schedule_windows ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_schedule_windows_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 251 (class 1259 OID 42951)
-- Name: job_step_agents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_step_agents (
    id integer NOT NULL,
    step_id integer NOT NULL,
    camera_id integer,
    agent_key text NOT NULL,
    prompt_template text NOT NULL,
    params text,
    input_schema text,
    is_active integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    alert_condition text,
    negative_condition text,
    priority_level text DEFAULT 'MEDIUM'::text,
    input_type text DEFAULT 'video'::text NOT NULL,
    inference_model text DEFAULT 'ultra'::text NOT NULL,
    run_every integer DEFAULT 60 NOT NULL,
    analysis_regions text,
    CONSTRAINT job_step_agents_inference_model_chk CHECK ((inference_model = ANY (ARRAY['legacy'::text, 'pro'::text, 'ultra'::text, 'ultra_plus'::text, 'light'::text, 'core'::text]))),
    CONSTRAINT job_step_agents_input_type_chk CHECK ((input_type = ANY (ARRAY['video'::text, 'image'::text]))),
    CONSTRAINT job_step_agents_run_every_chk CHECK ((run_every = ANY (ARRAY[10, 30, 60, 300, 600, 1800, 3600, 10800])))
);


ALTER TABLE public.job_step_agents OWNER TO postgres;

ALTER TABLE public.job_step_agents
    ADD COLUMN IF NOT EXISTS negative_condition text;

ALTER TABLE public.job_step_agents
    ADD COLUMN IF NOT EXISTS analysis_regions text;

ALTER TABLE public.job_step_agents
    ADD COLUMN IF NOT EXISTS use_temporal_context integer NOT NULL DEFAULT 1;

--
-- TOC entry 252 (class 1259 OID 42960)
-- Name: job_step_agents_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_step_agents ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_step_agents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 253 (class 1259 OID 42961)
-- Name: job_step_alert_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_step_alert_rules (
    id integer NOT NULL,
    step_id integer NOT NULL,
    condition_expr text NOT NULL,
    channel text NOT NULL,
    channel_params text,
    message_template text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_step_alert_rules OWNER TO postgres;

--
-- TOC entry 254 (class 1259 OID 42968)
-- Name: job_step_alert_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_step_alert_rules ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_step_alert_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 255 (class 1259 OID 42969)
-- Name: job_step_run_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_step_run_logs (
    id integer NOT NULL,
    run_id integer NOT NULL,
    log_level text NOT NULL,
    message text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_step_run_logs OWNER TO postgres;

--
-- TOC entry 256 (class 1259 OID 42975)
-- Name: job_step_run_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_step_run_logs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_step_run_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 257 (class 1259 OID 42976)
-- Name: job_step_run_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_step_run_results (
    id integer NOT NULL,
    run_id integer NOT NULL,
    result_data text,
    output_data text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_step_run_results OWNER TO postgres;

--
-- TOC entry 258 (class 1259 OID 42983)
-- Name: job_step_run_results_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_step_run_results ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_step_run_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 259 (class 1259 OID 42984)
-- Name: job_step_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_step_runs (
    id integer NOT NULL,
    job_id integer NOT NULL,
    step_id integer NOT NULL,
    camera_id integer NOT NULL,
    step_agent_id integer NOT NULL,
    status text DEFAULT 'pending'::text,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    timeout_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_step_runs OWNER TO postgres;

--
-- TOC entry 260 (class 1259 OID 42992)
-- Name: job_step_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_step_runs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_step_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 261 (class 1259 OID 42993)
-- Name: job_step_targets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_step_targets (
    id integer NOT NULL,
    step_id integer NOT NULL,
    camera_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.job_step_targets OWNER TO postgres;

--
-- TOC entry 262 (class 1259 OID 42998)
-- Name: job_step_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_step_targets ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_step_targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 263 (class 1259 OID 42999)
-- Name: job_steps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.job_steps (
    id integer NOT NULL,
    job_id integer NOT NULL,
    step_order integer NOT NULL,
    name text NOT NULL,
    timeout_seconds integer NOT NULL,
    status text DEFAULT 'draft'::text,
    input_from_step_id integer,
    input_inject_key text,
    on_missing_input text DEFAULT 'skip'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    start_condition text,
    start_condition_from_step_id integer,
    inference_groups text
);


ALTER TABLE public.job_steps OWNER TO postgres;

--
-- TOC entry 264 (class 1259 OID 43008)
-- Name: job_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.job_steps ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.job_steps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 265 (class 1259 OID 43009)
-- Name: jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.jobs (
    id integer NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    description text,
    start_at timestamp without time zone,
    end_at timestamp without time zone,
    status text DEFAULT 'draft'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    schedule_mode text,
    timezone text,
    active_from date,
    active_until date,
    is_active integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.jobs OWNER TO postgres;

--
-- TOC entry 266 (class 1259 OID 43017)
-- Name: jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.jobs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 267 (class 1259 OID 43018)
-- Name: local_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.local_sessions (
    id integer NOT NULL,
    session_token text NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.local_sessions OWNER TO postgres;

--
-- TOC entry 268 (class 1259 OID 43024)
-- Name: local_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.local_sessions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.local_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 269 (class 1259 OID 43025)
-- Name: local_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.local_users (
    id integer NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    email_verified integer DEFAULT 0,
    verify_token text,
    reset_token text,
    reset_token_expires_at timestamp without time zone,
    country_code text,
    locale text,
    last_login_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.local_users OWNER TO postgres;

--
-- TOC entry 270 (class 1259 OID 43033)
-- Name: local_users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.local_users ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.local_users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 292 (class 1259 OID 51534)
-- Name: model_api_keys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.model_api_keys (
    id integer NOT NULL,
    model_name text NOT NULL,
    api_key text NOT NULL,
    is_active integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    default_fps integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.model_api_keys OWNER TO postgres;

--
-- TOC entry 291 (class 1259 OID 51533)
-- Name: model_api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.model_api_keys ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.model_api_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 271 (class 1259 OID 43034)
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id text NOT NULL,
    camera_id integer,
    type text NOT NULL,
    title text NOT NULL,
    message text,
    image_key text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_read integer DEFAULT 0 NOT NULL,
    event_id integer,
    video_key text,
    media_type text DEFAULT 'image'::text
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- TOC entry 272 (class 1259 OID 43042)
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.notifications_id_seq OWNER TO postgres;

--
-- TOC entry 5483 (class 0 OID 0)
-- Dependencies: 272
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- TOC entry 273 (class 1259 OID 43043)
-- Name: pair_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pair_codes (
    code text NOT NULL,
    user_id text NOT NULL,
    client_id text NOT NULL,
    created_at text NOT NULL,
    expires_at text NOT NULL,
    used_at text,
    id text,
    pair_code text
);


ALTER TABLE public.pair_codes OWNER TO postgres;

--
-- TOC entry 274 (class 1259 OID 43048)
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    user_id text NOT NULL,
    stripe_payment_id text NOT NULL,
    amount integer NOT NULL,
    currency text DEFAULT 'usd'::text,
    payment_type text NOT NULL,
    status text NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- TOC entry 275 (class 1259 OID 43056)
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq OWNER TO postgres;

--
-- TOC entry 5484 (class 0 OID 0)
-- Dependencies: 275
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- TOC entry 276 (class 1259 OID 43057)
-- Name: reid_targets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reid_targets (
    id integer NOT NULL,
    user_id text NOT NULL,
    camera_id integer,
    target_name text NOT NULL,
    description text,
    image_key text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    person_name text,
    person_description text
);


ALTER TABLE public.reid_targets OWNER TO postgres;

--
-- TOC entry 277 (class 1259 OID 43064)
-- Name: reid_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reid_targets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reid_targets_id_seq OWNER TO postgres;

--
-- TOC entry 5485 (class 0 OID 0)
-- Dependencies: 277
-- Name: reid_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reid_targets_id_seq OWNED BY public.reid_targets.id;


--
-- TOC entry 278 (class 1259 OID 43065)
-- Name: stripe_customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stripe_customers (
    id integer NOT NULL,
    user_id text NOT NULL,
    stripe_customer_id text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.stripe_customers OWNER TO postgres;

--
-- TOC entry 279 (class 1259 OID 43072)
-- Name: stripe_customers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stripe_customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stripe_customers_id_seq OWNER TO postgres;

--
-- TOC entry 5486 (class 0 OID 0)
-- Dependencies: 279
-- Name: stripe_customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stripe_customers_id_seq OWNED BY public.stripe_customers.id;


--
-- TOC entry 280 (class 1259 OID 43073)
-- Name: subscription_token_usage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscription_token_usage (
    id integer NOT NULL,
    subscription_id integer NOT NULL,
    camera_id integer,
    event_time text NOT NULL,
    prompt_tokens integer NOT NULL,
    output_tokens integer NOT NULL,
    total_tokens integer NOT NULL,
    source text,
    algo_type text
);


ALTER TABLE public.subscription_token_usage OWNER TO postgres;

--
-- TOC entry 281 (class 1259 OID 43078)
-- Name: subscription_token_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.subscription_token_usage ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.subscription_token_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 282 (class 1259 OID 43079)
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id integer NOT NULL,
    user_id text NOT NULL,
    stripe_subscription_id text NOT NULL,
    plan_id text NOT NULL,
    status text NOT NULL,
    started_at timestamp without time zone,
    ended_at timestamp without time zone,
    cancel_at_period_end integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    camera_count integer DEFAULT 1,
    seconds_per_frame integer DEFAULT 3,
    model_tier text DEFAULT 'plus'::text,
    "InputTokensM" real DEFAULT 0,
    "OutputTokensM" real DEFAULT 0,
    "InputTokensUsedM" real DEFAULT 0,
    "OutputTokensUsedM" real DEFAULT 0,
    inputtokensm real DEFAULT 0,
    outputtokensm real DEFAULT 0,
    inputtokensusedm real DEFAULT 0,
    outputtokensusedm real DEFAULT 0,
    camera_id integer,
    subscription_type text,
    is_active integer DEFAULT 1,
    expires_at timestamp without time zone
);


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- TOC entry 283 (class 1259 OID 43099)
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subscriptions_id_seq OWNER TO postgres;

--
-- TOC entry 5487 (class 0 OID 0)
-- Dependencies: 283
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- TOC entry 284 (class 1259 OID 43100)
-- Name: telegram_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.telegram_settings (
    id text NOT NULL,
    user_id text NOT NULL,
    enabled integer DEFAULT 0 NOT NULL,
    profile text DEFAULT ''::text NOT NULL,
    chat_id text DEFAULT ''::text NOT NULL,
    bot_token text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.telegram_settings OWNER TO postgres;

--
-- TOC entry 285 (class 1259 OID 43111)
-- Name: token_balances; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.token_balances (
    id integer NOT NULL,
    user_id text NOT NULL,
    tokens integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    balance integer DEFAULT 0,
    total_spent integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    input_balance integer DEFAULT 0,
    output_balance integer DEFAULT 0
);


ALTER TABLE public.token_balances OWNER TO postgres;

--
-- TOC entry 286 (class 1259 OID 43123)
-- Name: token_balances_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.token_balances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.token_balances_id_seq OWNER TO postgres;

--
-- TOC entry 5488 (class 0 OID 0)
-- Dependencies: 286
-- Name: token_balances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.token_balances_id_seq OWNED BY public.token_balances.id;


--
-- TOC entry 287 (class 1259 OID 43124)
-- Name: user_frame_rate; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_frame_rate (
    user_id text NOT NULL,
    frame_rate integer NOT NULL,
    updated_at text NOT NULL
);


ALTER TABLE public.user_frame_rate OWNER TO postgres;

--
-- TOC entry 288 (class 1259 OID 43129)
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_preferences (
    user_id text NOT NULL,
    language text DEFAULT 'en'::text,
    theme text DEFAULT 'dark'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.user_preferences OWNER TO postgres;

--
-- TOC entry 289 (class 1259 OID 43138)
-- Name: video_uploads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.video_uploads (
    id integer NOT NULL,
    user_id text NOT NULL,
    storage_key text NOT NULL,
    public_url text,
    original_name text,
    mime_type text,
    size_bytes integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.video_uploads OWNER TO postgres;

--
-- TOC entry 290 (class 1259 OID 43145)
-- Name: video_uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.video_uploads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.video_uploads_id_seq OWNER TO postgres;

--
-- TOC entry 5489 (class 0 OID 0)
-- Dependencies: 290
-- Name: video_uploads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.video_uploads_id_seq OWNED BY public.video_uploads.id;


--
-- TOC entry 4939 (class 2604 OID 43146)
-- Name: active_cards id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_cards ALTER COLUMN id SET DEFAULT nextval('public.active_cards_id_seq'::regclass);


--
-- TOC entry 4943 (class 2604 OID 43147)
-- Name: camera_algorithms id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.camera_algorithms ALTER COLUMN id SET DEFAULT nextval('public.camera_algorithms_id_seq'::regclass);


--
-- TOC entry 4947 (class 2604 OID 43148)
-- Name: cameras id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cameras ALTER COLUMN id SET DEFAULT nextval('public.cameras_id_seq'::regclass);


--
-- TOC entry 4958 (class 2604 OID 43149)
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- TOC entry 4967 (class 2604 OID 43150)
-- Name: chat_sessions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_sessions ALTER COLUMN id SET DEFAULT nextval('public.chat_sessions_id_seq'::regclass);


--
-- TOC entry 4970 (class 2604 OID 43151)
-- Name: commands id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commands ALTER COLUMN id SET DEFAULT nextval('public.commands_id_seq'::regclass);


--
-- TOC entry 4976 (class 2604 OID 43152)
-- Name: detections id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detections ALTER COLUMN id SET DEFAULT nextval('public.detections_id_seq'::regclass);


--
-- TOC entry 4979 (class 2604 OID 43153)
-- Name: events id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- TOC entry 5025 (class 2604 OID 43154)
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- TOC entry 5029 (class 2604 OID 43155)
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- TOC entry 5033 (class 2604 OID 43156)
-- Name: reid_targets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reid_targets ALTER COLUMN id SET DEFAULT nextval('public.reid_targets_id_seq'::regclass);


--
-- TOC entry 5036 (class 2604 OID 43157)
-- Name: stripe_customers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stripe_customers ALTER COLUMN id SET DEFAULT nextval('public.stripe_customers_id_seq'::regclass);


--
-- TOC entry 5039 (class 2604 OID 43158)
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- TOC entry 5061 (class 2604 OID 43159)
-- Name: token_balances id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.token_balances ALTER COLUMN id SET DEFAULT nextval('public.token_balances_id_seq'::regclass);


--
-- TOC entry 5073 (class 2604 OID 43160)
-- Name: video_uploads id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_uploads ALTER COLUMN id SET DEFAULT nextval('public.video_uploads_id_seq'::regclass);


--
-- TOC entry 5394 (class 0 OID 42790)
-- Dependencies: 217
-- Data for Name: active_cards; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.active_cards (id, user_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, is_default, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 5396 (class 0 OID 42797)
-- Dependencies: 219
-- Data for Name: app_users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.app_users (id, email, auth_provider, country_code, locale, created_at, updated_at) FROM stdin;
local:1	nrag2007@gmail.com	local	BR	\N	2026-02-05 20:44:38.612	2026-02-19 00:08:19.785
\.


--
-- TOC entry 5397 (class 0 OID 42804)
-- Dependencies: 220
-- Data for Name: camera_algorithms; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.camera_algorithms (id, camera_id, algorithm_type, is_enabled, llm_prompt, image_region, config_json, created_at, updated_at) FROM stdin;
1	2	weapon	0	\N	\N	\N	2026-02-06 10:31:46.074127	2026-02-06 18:31:16.015066
\.


--
-- TOC entry 5399 (class 0 OID 42813)
-- Dependencies: 222
-- Data for Name: cameras; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cameras (id, user_id, name, ip_address, rtsp_port, manufacturer, username, password, connection_method, is_online, is_service_running, thumbnail_url, last_thumbnail_update, created_at, updated_at, store_frames, retention_days, description, street, number, neighborhood, city, state, zip_code, complement, country, timezone, utc_offset_seconds, webcam_index, allowpublicaccess, analysis_speed, model_tier, channel, subtype) FROM stdin;
1	demo-user	Camera Rua esquerda 	192.168.0.65	554	Hikvision			RTSP	0	0	\N	\N	2025-12-07 11:14:36.452351	2025-12-08 20:30:32.838	1	7	LABEL: other_indoor DESCRIPTION: Câmera do portão	Rua Jose Celestino da Luz	99	\N	Boa Vista	RR	69307-600	\N	BR	\N	-14400	\N	1	3	plus	\N	\N
2	local:1	hikvision escritorio	192.168.1.64	\N	Hikvision	admin	Nick2007	RTSP	0	0	user_local:1_camera_2_1770638700815.jpg	2026-02-09 12:05:00.818	2026-02-05 17:51:02.436163	2026-02-10 09:03:07.90331	1	1	LABEL: office_room\nDESCRIPTION: The environment has a simple design with a table and a dim, cool-toned lighting.\n	avenida prefeito dulcidio cardoso	11100	\N	Rio de Janeiro	RJ	22793012	\N	Brazil	UTC+0	0	\N	0	3	plus	\N	\N
4	local:1	Webcam webcam		\N	Webcam	\N	\N	WEBCAM	0	0	user_local:1_camera_4_1771457059559.jpg	2026-02-18 23:24:19.56	2026-02-06 18:35:32.055089	2026-02-18 20:24:50.993896	1	1	LABEL: other_indoor\nDESCRIPTION: The environment is dark.\n	avenida prefeito dulcidio cardoso	11100	\N	Rio de Janeiro	RJ	22793012	\N	Brazil	UTC+0	0	0	0	3	plus	\N	\N
8	local:1	SAP_C: Recepcao 2	10.18.4.96	554	Intelbras	admin	ADMcoint2025	RTSP	0	0	user_local:1_camera_8_1770817516699.jpg	2026-02-11 13:45:16.705	2026-02-10 14:23:56.887863	2026-02-13 09:01:28.191412	1	1	LABEL: reception\nDESCRIPTION: The environment appears to be a brightly lit, tiled-floor area with security equipment.	avenida prefeito dulcidio cardoso	11100	\N	Rio de Janeiro	RJ	22793012	\N	Brazil	UTC+0	0	\N	0	3	plus	\N	\N
3	local:1	mibo	192.168.0.107	554	Intelbras	admin	Mibo2025*	RTSP	0	0	user_local:1_camera_3_1771457060923.jpg	2026-02-18 23:24:20.925	2026-02-06 18:33:16.215294	2026-02-18 20:24:50.698265	1	1	LABEL: office_room DESCRIPTION: The environment appears to be an interior space with a neutral-toned wall and a window providing an indirect light source.	avenida prefeito dulcidio cardoso	11100	\N	Rio de Janeiro	RJ	22793012	\N	Brazil	UTC+0	0	\N	0	3	plus	\N	\N
\.


--
-- TOC entry 5401 (class 0 OID 42827)
-- Dependencies: 224
-- Data for Name: chat_hit_images; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chat_hit_images (id, user_id, chat_session_id, camera_id, r2_key, time_in_video, created_at, media_type, mime_type) FROM stdin;
\.


--
-- TOC entry 5403 (class 0 OID 42835)
-- Dependencies: 226
-- Data for Name: chat_messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chat_messages (id, user_id, role, content, camera_ids, tokens_used, created_at, updated_at, session_id, message_type, is_pending, model_prompt_tokens, model_output_tokens, model_total_tokens, camera_selection_json, uploaded_image_base64) FROM stdin;
1	demo-user	user	Olá, sistema, o que você faz?	1	0	2025-12-07 12:04:31.341294	2025-12-07 12:04:31.341294	1	final	0	0	0	0	{"mode":"selected","cameraIds":[1]}	\N
2	demo-user	assistant	LLM stub: recebi sua mensagem "Olá, sistema, o que você faz?". Integração com modelo real ainda não está configurada neste backend.	1	0	2025-12-07 12:04:31.344509	2025-12-07 12:04:31.344509	1	final	0	0	0	0	{"mode":"selected","cameraIds":[1]}	\N
3	local:1	user	me descreva o ambiente da camera recepcao	\N	0	2026-02-10 17:29:07.709	2026-02-10 17:29:07.709	23	final	0	0	0	0	\N	\N
4	local:1	assistant	Vou analisar o ambiente na câmera SAP_C: Recepcao 2 na última minuto.	8	0	2026-02-10 17:29:07.709	2026-02-10 17:29:17.753	23	router_ack	0	0	0	0	{"type":"router_ack","query":"me descreva o ambiente da camera recepcao","camera_ids":[8],"camera_names":["SAP_C: Recepcao 2"],"all_cameras":false,"time_window_minutes_before_now":1,"tokens_prompt":0,"tokens_output":0,"tokens_total":0}	\N
5	local:1	assistant	Analyzing camera feed...	\N	0	2026-02-10 17:29:17.753	2026-02-10 17:29:17.753	23	final_answer_pending	1	0	0	0	\N	\N
\.


--
-- TOC entry 5405 (class 0 OID 42849)
-- Dependencies: 228
-- Data for Name: chat_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chat_sessions (id, user_id, title, created_at, updated_at) FROM stdin;
1	demo-user	Minha primeira conversa	2025-12-07 12:03:42.145913	2025-12-07 12:03:42.145913
2	local:1	New chat 01	2026-02-05 20:49:46.361	2026-02-05 20:49:46.361
3	local:1	New chat 01	2026-02-05 20:49:46.352	2026-02-05 20:49:46.352
4	local:1	New chat 21	2026-02-05 21:07:53.194	2026-02-05 21:07:53.194
5	local:1	New chat 31	2026-02-05 21:07:53.217	2026-02-05 21:07:53.217
6	local:1	Quick chat – Feb 5, 6:42 PM	2026-02-05 21:42:54.497	2026-02-05 21:42:54.497
7	local:1	New chat 41	2026-02-06 09:58:08.241	2026-02-06 09:58:08.241
8	local:1	New chat 41	2026-02-06 09:58:08.248	2026-02-06 09:58:08.248
9	local:1	New chat 61	2026-02-06 21:31:54.703	2026-02-06 21:31:54.703
10	local:1	New chat 71	2026-02-06 21:31:54.832	2026-02-06 21:31:54.832
11	local:1	New chat 81	2026-02-07 20:25:43.25	2026-02-07 20:25:43.25
12	local:1	New chat 91	2026-02-07 20:25:43.29	2026-02-07 20:25:43.29
13	local:1	New chat 101	2026-02-09 12:41:00.474	2026-02-09 12:41:00.474
14	local:1	New chat 101	2026-02-09 12:41:00.484	2026-02-09 12:41:00.484
15	local:1	New chat 121	2026-02-09 13:45:47.804	2026-02-09 13:45:47.804
16	local:1	New chat 121	2026-02-09 13:45:47.803	2026-02-09 13:45:47.803
17	local:1	New chat 141	2026-02-09 22:56:07.152	2026-02-09 22:56:07.152
18	local:1	New chat 151	2026-02-09 22:56:07.177	2026-02-09 22:56:07.177
19	local:1	New chat 161	2026-02-10 13:51:01.52	2026-02-10 13:51:01.52
20	local:1	New chat 171	2026-02-10 13:51:01.547	2026-02-10 13:51:01.547
21	local:1	New chat 181	2026-02-10 13:51:11.69	2026-02-10 13:51:11.69
22	local:1	New chat 191	2026-02-10 13:51:11.695	2026-02-10 13:51:11.695
23	local:1	Quick chat – Feb 10, 2:28 PM	2026-02-10 17:28:55.996	2026-02-10 14:29:17.755951
24	local:1	New chat 201	2026-02-10 18:04:00.918	2026-02-10 18:04:00.918
25	local:1	New chat 211	2026-02-10 18:04:00.926	2026-02-10 18:04:00.926
26	local:1	New chat 221	2026-02-13 11:58:48.166	2026-02-13 11:58:48.166
27	local:1	New chat 221	2026-02-13 11:58:48.174	2026-02-13 11:58:48.174
28	local:1	New chat 241	2026-02-13 12:02:27.377	2026-02-13 12:02:27.377
29	local:1	New chat 251	2026-02-13 12:02:27.386	2026-02-13 12:02:27.386
30	local:1	New chat 261	2026-02-13 15:01:24.019	2026-02-13 15:01:24.019
31	local:1	New chat 271	2026-02-13 15:01:24.043	2026-02-13 15:01:24.043
32	local:1	New chat 281	2026-02-13 21:32:57.98	2026-02-13 21:32:57.98
33	local:1	New chat 281	2026-02-13 21:32:57.987	2026-02-13 21:32:57.987
34	local:1	Quick chat – Feb 15, 10:03 AM	2026-02-15 13:03:53.491	2026-02-15 13:03:53.491
35	local:1	Quick chat – Feb 17, 12:36 PM	2026-02-17 15:36:08.715	2026-02-17 15:36:08.715
36	local:1	New chat 301	2026-02-17 15:36:12.469	2026-02-17 15:36:12.469
37	local:1	New chat 311	2026-02-17 15:36:12.489	2026-02-17 15:36:12.489
38	local:1	New chat 321	2026-02-17 16:39:02.513	2026-02-17 16:39:02.513
39	local:1	New chat 331	2026-02-17 16:39:02.523	2026-02-17 16:39:02.523
\.


--
-- TOC entry 5407 (class 0 OID 42857)
-- Dependencies: 230
-- Data for Name: commands; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.commands (id, user_id, camera_id, command_type, payload, status, result, created_at, updated_at) FROM stdin;
1	local:1	2	add_camera	{"id":2,"user_id":"local:1","name":"hikvision escritorio","ip_address":"192.168.1.64","rtsp_port":null,"manufacturer":"Hikvision","username":"admin","password":"Nick2007","connection_method":"RTSP","is_online":0,"is_service_running":0,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-05T20:51:02.436Z","updated_at":"2026-02-05T20:51:02.436Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"plus"}	sent	\N	2026-02-05 17:51:02.440436	2026-02-05 21:39:52.537
62	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T14:54:03.244Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-08 14:54:03.244	2026-02-08 14:54:18.117
2	local:1	2	update_camera	{"id":2,"user_id":"local:1","name":"hikvision escritorio","ip_address":"192.168.1.64","rtsp_port":null,"manufacturer":"Hikvision","username":"admin","password":"Nick2007","connection_method":"RTSP","is_online":0,"is_service_running":1,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-05T20:51:02.436Z","updated_at":"2026-02-05T21:39:58.124Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"light"}	sent	\N	2026-02-05 18:39:58.138652	2026-02-05 21:40:07.57
3	local:1	2	start_camera	{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":3,"model_tier":"light","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}	sent	\N	2026-02-05 21:39:58.15	2026-02-05 21:40:07.57
138	local:1	8	stop_camera	{"camera_id":8}	sent	\N	2026-02-10 14:25:26.470362	2026-02-10 17:25:29.405
87	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T16:12:09.292Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 16:12:09.292	2026-02-09 16:12:19.666
4	local:1	2	update_camera	{"id":2,"user_id":"local:1","name":"hikvision escritorio","ip_address":"192.168.1.64","rtsp_port":null,"manufacturer":"Hikvision","username":"admin","password":"Nick2007","connection_method":"RTSP","is_online":1,"is_service_running":0,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-05T20:51:02.436Z","updated_at":"2026-02-05T21:41:25.749Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"light"}	sent	\N	2026-02-05 18:41:25.752752	2026-02-05 21:41:37.839
5	local:1	2	stop_camera	{"camera_id":2}	sent	\N	2026-02-05 18:41:25.763071	2026-02-05 21:41:37.839
6	local:1	2	update_camera	{"id":2,"user_id":"local:1","name":"hikvision escritorio","ip_address":"192.168.1.64","rtsp_port":null,"manufacturer":"Hikvision","username":"admin","password":"Nick2007","connection_method":"RTSP","is_online":1,"is_service_running":1,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-05T20:51:02.436Z","updated_at":"2026-02-05T21:42:12.288Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"light"}	sent	\N	2026-02-05 18:42:12.29013	2026-02-05 21:42:22.946
7	local:1	2	start_camera	{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":3,"model_tier":"light","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}	sent	\N	2026-02-05 21:42:12.306	2026-02-05 21:42:22.946
118	local:1	6	delete_camera	{"camera_id":"6"}	sent	\N	2026-02-10 09:25:06.104787	2026-02-10 12:25:11.302
119	local:1	5	delete_camera	{"camera_id":"5"}	sent	\N	2026-02-10 09:25:08.144541	2026-02-10 12:25:11.302
8	local:1	2	update_camera	{"id":2,"user_id":"local:1","name":"hikvision escritorio","ip_address":"192.168.1.64","rtsp_port":null,"manufacturer":"Hikvision","username":"admin","password":"Nick2007","connection_method":"RTSP","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_2_1770327867243.jpg","last_thumbnail_update":"2026-02-06T00:44:27.244Z","created_at":"2026-02-05T20:51:02.436Z","updated_at":"2026-02-05T21:45:22.592Z","store_frames":1,"retention_days":1,"description":"LABEL: office_room\\nDESCRIPTION: The environment has a simple design with a table and a dim, cool-toned lighting.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"light"}	sent	\N	2026-02-05 18:45:22.594938	2026-02-05 21:45:23.462
9	local:1	2	stop_camera	{"camera_id":2}	sent	\N	2026-02-05 18:45:22.600531	2026-02-05 21:45:23.462
10	local:1	2	update_camera	{"id":2,"user_id":"local:1","name":"hikvision escritorio","ip_address":"192.168.1.64","rtsp_port":null,"manufacturer":"Hikvision","username":"admin","password":"Nick2007","connection_method":"RTSP","is_online":1,"is_service_running":1,"thumbnail_url":"user_local:1_camera_2_1770327867243.jpg","last_thumbnail_update":"2026-02-06T00:44:27.244Z","created_at":"2026-02-05T20:51:02.436Z","updated_at":"2026-02-06T13:31:50.411Z","store_frames":1,"retention_days":1,"description":"LABEL: office_room\\nDESCRIPTION: The environment has a simple design with a table and a dim, cool-toned lighting.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-06 10:31:50.413576	2026-02-06 13:32:56.408
11	local:1	2	start_camera	{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[{"algorithm_type":"weapon","is_enabled":true,"llm_prompt":"Detect firearms, knives, and other weapons","image_region":null,"config_json":{"display_name":"Weapon Detection"}}],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}	sent	\N	2026-02-06 13:31:50.426	2026-02-06 13:32:56.408
12	local:1	2	start_camera	{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[{"algorithm_type":"weapon","is_enabled":true,"llm_prompt":"Detect firearms, knives, and other weapons","image_region":null,"config_json":{"display_name":"Weapon Detection"}}],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}	sent	\N	2026-02-06 13:32:56.404	2026-02-06 13:32:56.408
137	local:1	8	update_camera	{"id":8,"user_id":"local:1","name":"SAP_C: Recepcao 2","ip_address":"10.18.4.96","rtsp_port":"554","manufacturer":"Intelbras","username":"admin","password":"ADMcoint2025","connection_method":"RTSP","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_8_1770744316726.jpg","last_thumbnail_update":"2026-02-10T20:25:16.731Z","created_at":"2026-02-10T17:23:56.887Z","updated_at":"2026-02-10T17:25:26.452Z","store_frames":1,"retention_days":1,"description":"LABEL: reception\\nDESCRIPTION: The environment appears to be a brightly lit, tiled-floor area with security equipment.","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-10 14:25:26.457821	2026-02-10 17:25:29.405
89	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T16:19:11.447Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 16:19:11.447	2026-02-09 16:19:23.348
13	local:1	2	update_camera	{"id":2,"user_id":"local:1","name":"hikvision escritorio","ip_address":"192.168.1.64","rtsp_port":null,"manufacturer":"Hikvision","username":"admin","password":"Nick2007","connection_method":"RTSP","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_2_1770384782839.jpg","last_thumbnail_update":"2026-02-06T16:33:02.842Z","created_at":"2026-02-05T20:51:02.436Z","updated_at":"2026-02-06T13:33:22.638Z","store_frames":1,"retention_days":1,"description":"LABEL: office_room\\nDESCRIPTION: The environment has a simple design with a table and a dim, cool-toned lighting.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-06 10:33:22.641828	2026-02-06 13:33:28.623
14	local:1	2	stop_camera	{"camera_id":2}	sent	\N	2026-02-06 10:33:22.649085	2026-02-06 13:33:28.623
15	local:1	2	update_camera	{"id":2,"user_id":"local:1","name":"hikvision escritorio","ip_address":"192.168.1.64","rtsp_port":null,"manufacturer":"Hikvision","username":"admin","password":"Nick2007","connection_method":"RTSP","is_online":1,"is_service_running":1,"thumbnail_url":"user_local:1_camera_2_1770384782839.jpg","last_thumbnail_update":"2026-02-06T16:33:02.842Z","created_at":"2026-02-05T20:51:02.436Z","updated_at":"2026-02-06T13:38:29.766Z","store_frames":1,"retention_days":1,"description":"LABEL: office_room\\nDESCRIPTION: The environment has a simple design with a table and a dim, cool-toned lighting.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-06 10:38:29.778093	2026-02-06 13:38:41.815
16	local:1	2	start_camera	{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[{"algorithm_type":"weapon","is_enabled":true,"llm_prompt":"Detect firearms, knives, and other weapons","image_region":null,"config_json":{"display_name":"Weapon Detection"}}],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}	sent	\N	2026-02-06 13:38:29.79	2026-02-06 13:38:41.815
17	local:1	2	start_camera	{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[{"algorithm_type":"weapon","is_enabled":true,"llm_prompt":"Detect firearms, knives, and other weapons","image_region":null,"config_json":{"display_name":"Weapon Detection"}}],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}	sent	\N	2026-02-06 21:30:44.6	2026-02-06 21:30:44.619
18	local:1	2	update_algorithms	{"camera_id":2,"enabled_algorithms":[]}	sent	\N	2026-02-06 21:31:16.018	2026-02-06 21:31:29.867
19	local:1	3	add_camera	{"id":3,"user_id":"local:1","name":"mibo","ip_address":"192.168.0.31","rtsp_port":"554","manufacturer":"Intelbras","username":"admin","password":"Mibo2025*","connection_method":"RTSP","is_online":0,"is_service_running":0,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-06T21:33:16.215Z","updated_at":"2026-02-06T21:33:16.215Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"plus"}	sent	\N	2026-02-06 18:33:16.217769	2026-02-06 21:33:30.186
20	local:1	3	update_camera	{"id":3,"user_id":"local:1","name":"mibo","ip_address":"192.168.0.31","rtsp_port":"554","manufacturer":"Intelbras","username":"admin","password":"Mibo2025*","connection_method":"RTSP","is_online":0,"is_service_running":1,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-06T21:33:16.215Z","updated_at":"2026-02-06T21:33:48.897Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-06 18:33:48.898676	2026-02-06 21:34:00.268
21	local:1	3	start_camera	{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}	sent	\N	2026-02-06 21:33:48.906	2026-02-06 21:34:00.268
149	local:1	\N	job_stop	{"job":{"id":6,"name":"Analise Recepcao SAP_C"},"requested_at_utc":"2026-02-10T18:03:59.659Z","reason":"user_stop_from_dashboard","camera_ids":[8]}	sent	\N	2026-02-10 18:03:59.659	2026-02-10 18:04:11.075
129	local:1	7	delete_camera	{"camera_id":"7"}	sent	\N	2026-02-10 09:26:42.332875	2026-02-10 12:26:57.464
63	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"12:23","schedule_mode":"weekly","schedule_day":{"id":156,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":156,"start_time":"12:23","end_time":"23:00"},"triggered_at_utc":"2026-02-08T15:23:05.023Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":60,"time_hhmm":"12:24"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 15:23:05.018	2026-02-08 15:23:08.5
70	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"17:14","schedule_mode":"weekly","schedule_day":{"id":184,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":184,"start_time":"17:14","end_time":"23:00"},"triggered_at_utc":"2026-02-08T20:14:05.025Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-08 20:14:05.021	2026-02-08 20:14:08.251
22	local:1	4	add_camera	{"id":4,"user_id":"local:1","name":"Webcam webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":0,"is_service_running":0,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-06T21:35:32.055Z","updated_at":"2026-02-06T21:35:32.055Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":0,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"plus"}	sent	\N	2026-02-06 18:35:32.059616	2026-02-06 21:35:45.656
23	local:1	4	update_camera	{"id":4,"user_id":"local:1","name":"Webcam webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":0,"is_service_running":1,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-06T21:35:32.055Z","updated_at":"2026-02-06T21:35:38.859Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":0,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-06 18:35:38.860898	2026-02-06 21:35:45.656
24	local:1	4	start_camera	{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}	sent	\N	2026-02-06 21:35:38.869	2026-02-06 21:35:45.656
25	local:1	4	update_camera	{"id":4,"user_id":"local:1","name":"Webcam webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_4_1770413807423.jpg","last_thumbnail_update":"2026-02-07T00:36:47.428Z","created_at":"2026-02-06T21:35:32.055Z","updated_at":"2026-02-06T21:37:11.225Z","store_frames":1,"retention_days":1,"description":"LABEL: other_indoor\\nDESCRIPTION: The environment is dark.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":0,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-06 18:37:11.23053	2026-02-06 21:37:15.862
26	local:1	4	stop_camera	{"camera_id":4}	sent	\N	2026-02-06 18:37:11.244121	2026-02-06 21:37:15.862
28	local:1	3	stop_camera	{"camera_id":3}	sent	\N	2026-02-06 18:37:12.184336	2026-02-06 21:37:15.862
30	local:1	2	stop_camera	{"camera_id":2}	sent	\N	2026-02-06 18:37:13.20814	2026-02-06 21:37:15.862
27	local:1	3	update_camera	{"id":3,"user_id":"local:1","name":"mibo","ip_address":"192.168.0.31","rtsp_port":"554","manufacturer":"Intelbras","username":"admin","password":"Mibo2025*","connection_method":"RTSP","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_3_1770413824420.jpg","last_thumbnail_update":"2026-02-07T00:37:04.423Z","created_at":"2026-02-06T21:33:16.215Z","updated_at":"2026-02-06T21:37:12.178Z","store_frames":1,"retention_days":1,"description":"LABEL: office_room\\nDESCRIPTION: The environment appears to be an interior space with a neutral-toned wall and a window providing an indirect light source.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-06 18:37:12.179846	2026-02-06 21:37:15.862
179	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T15:21:16.141Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 15:21:16.141	2026-02-13 15:21:28.147
29	local:1	2	update_camera	{"id":2,"user_id":"local:1","name":"hikvision escritorio","ip_address":"192.168.1.64","rtsp_port":null,"manufacturer":"Hikvision","username":"admin","password":"Nick2007","connection_method":"RTSP","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_2_1770413809830.jpg","last_thumbnail_update":"2026-02-07T00:36:49.836Z","created_at":"2026-02-05T20:51:02.436Z","updated_at":"2026-02-06T21:37:13.197Z","store_frames":1,"retention_days":1,"description":"LABEL: office_room\\nDESCRIPTION: The environment has a simple design with a table and a dim, cool-toned lighting.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-06 18:37:13.199049	2026-02-06 21:37:15.862
31	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-06","local_time":"19:55","schedule_mode":"weekly","schedule_day":{"id":35,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":35,"start_time":"19:55","end_time":"23:00"},"triggered_at_utc":"2026-02-06T22:55:05.009Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":5,"agent_key":"contagem chegando escritorio","prompt_template":"Conte quantas pessoas visivelmente entraram no escritorio.","params":"{}","input_schema":"{}","camera_id":4},{"id":4,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas que visivelmente sairam da sala.","params":"{}","input_schema":"{}","camera_id":3}],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-06 22:55:04.997	2026-02-06 22:55:11.079
64	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T15:26:10.692Z","reason":"user_stop_from_dashboard","camera_ids":[2,4]}	sent	\N	2026-02-08 15:26:10.692	2026-02-08 15:26:23.928
32	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-06T22:55:47.448Z","reason":"user_stop_from_dashboard","camera_ids":[2,3,4]}	sent	\N	2026-02-06 22:55:47.448	2026-02-06 22:55:56.156
139	local:1	\N	chat_query	{"query":"me descreva o ambiente da camera recepcao","chat_session_id":23,"camera_id":null,"language":"pt","uploaded_image_base64":null,"uploaded_video_id":null,"uploaded_video_url":null,"model_tier":"light"}	sent	\N	2026-02-10 17:29:07.709	2026-02-10 17:29:14.889
51	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"09:35","schedule_mode":"weekly","schedule_day":{"id":107,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":107,"start_time":"09:35","end_time":"23:00"},"triggered_at_utc":"2026-02-08T12:35:05.041Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":6,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]}],"all_camera_ids":[4,3],"start_camera_payloads":{"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 12:35:05.027	2026-02-08 12:35:19.498
71	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T20:18:04.264Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-08 20:18:04.264	2026-02-08 20:18:08.777
75	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"09:00","schedule_mode":"weekly","schedule_day":{"id":192,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":192,"start_time":"09:00","end_time":"17:00"},"triggered_at_utc":"2026-02-09T12:00:05.187Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 12:00:05.022	2026-02-09 12:00:09.857
91	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T16:22:29.262Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 16:22:29.262	2026-02-09 16:22:40.37
33	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-07","local_time":"09:00","schedule_mode":"weekly","schedule_day":{"id":36,"day_name":"Saturday","day_of_week":6,"day_of_month":null,"month_of_year":null},"window":{"id":36,"start_time":"09:00","end_time":"17:00"},"triggered_at_utc":"2026-02-07T12:00:05.045Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":2,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":9,"agent_key":"contagem chegando escritorio","prompt_template":"Conte quantas pessoas visivelmente entraram no escritorio.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4},{"id":6,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.","params":"{}","input_schema":"{}","camera_id":3}],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-07 12:00:05.004	2026-02-07 12:00:18.588
34	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-07T12:08:40.007Z","reason":"user_stop_from_dashboard","camera_ids":[2,4,3]}	sent	\N	2026-02-07 12:08:40.007	2026-02-07 12:08:50.089
65	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"12:43","schedule_mode":"weekly","schedule_day":{"id":163,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":163,"start_time":"12:43","end_time":"23:00"},"triggered_at_utc":"2026-02-08T15:43:05.038Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum torcedor for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 15:43:05.034	2026-02-08 15:43:17.162
35	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-07","local_time":"10:59","schedule_mode":"weekly","schedule_day":{"id":43,"day_name":"Saturday","day_of_week":6,"day_of_month":null,"month_of_year":null},"window":{"id":43,"start_time":"10:59","end_time":"23:00"},"triggered_at_utc":"2026-02-07T13:59:05.010Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"positive","from_step_id":2,"camera_id":null,"extract":"result","pattern":"hikvision escritorio","time_offset_sec":null},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":9,"agent_key":"contagem chegando escritorio","prompt_template":"Conte quantas pessoas visivelmente entraram no escritorio.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4},{"id":6,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.","params":"{}","input_schema":"{}","camera_id":3}],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-07 13:59:05.007	2026-02-07 13:59:10.119
36	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-07T14:17:51.072Z","reason":"user_stop_from_dashboard","camera_ids":[2,3]}	sent	\N	2026-02-07 14:17:51.072	2026-02-07 14:18:02.335
37	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-07","local_time":"11:20","schedule_mode":"weekly","schedule_day":{"id":57,"day_name":"Saturday","day_of_week":6,"day_of_month":null,"month_of_year":null},"window":{"id":57,"start_time":"11:20","end_time":"23:00"},"triggered_at_utc":"2026-02-07T14:20:05.044Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":9,"agent_key":"contagem chegando escritorio","prompt_template":"Conte quantas pessoas visivelmente entraram no escritorio.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4},{"id":6,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.","params":"{}","input_schema":"{}","camera_id":3}],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-07 14:20:05.029	2026-02-07 14:20:18.085
76	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T12:11:15.314Z","reason":"user_stop_from_dashboard","camera_ids":[]}	sent	\N	2026-02-09 12:11:15.314	2026-02-09 12:11:26.446
38	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-07T14:21:19.518Z","reason":"user_stop_from_dashboard","camera_ids":[4,2,3]}	sent	\N	2026-02-07 14:21:19.518	2026-02-07 14:21:33.312
77	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-09T12:11:19.545Z","reason":"user_stop_from_dashboard","camera_ids":[]}	sent	\N	2026-02-09 12:11:19.545	2026-02-09 12:11:26.446
93	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T16:27:36.450Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 16:27:36.45	2026-02-09 16:27:42.2
39	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-07","local_time":"11:40","schedule_mode":"weekly","schedule_day":{"id":64,"day_name":"Saturday","day_of_week":6,"day_of_month":null,"month_of_year":null},"window":{"id":64,"start_time":"11:40","end_time":"23:00"},"triggered_at_utc":"2026-02-07T14:40:05.060Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":2,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":9,"agent_key":"contagem chegando escritorio","prompt_template":"Conte quantas pessoas visivelmente entraram no escritorio.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4},{"id":6,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.","params":"{}","input_schema":"{}","camera_id":3}],"alerts":[]},{"step":{"id":4,"step_order":3,"name":"test final","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"positive","from_step_id":3,"camera_id":null,"extract":"result","pattern":"mibo","time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]},{"step":{"id":5,"step_order":4,"name":"teste final 2","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":3300,"time_hhmm":"12:35"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-07 14:40:05.047	2026-02-07 14:40:08.133
40	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-07T14:43:42.399Z","reason":"user_stop_from_dashboard","camera_ids":[2,3]}	sent	\N	2026-02-07 14:43:42.399	2026-02-07 14:43:53.758
66	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T15:47:27.111Z","reason":"user_stop_from_dashboard","camera_ids":[2,4]}	sent	\N	2026-02-08 15:47:27.111	2026-02-08 15:47:32.767
187	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T21:32:50.641Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 21:32:50.641	2026-02-13 21:32:52.436
41	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-07","local_time":"17:11","schedule_mode":"weekly","schedule_day":{"id":71,"day_name":"Saturday","day_of_week":6,"day_of_month":null,"month_of_year":null},"window":{"id":71,"start_time":"17:11","end_time":"23:00"},"triggered_at_utc":"2026-02-07T20:11:05.030Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"positive","from_step_id":2,"camera_id":null,"extract":"if something ...","pattern":"hikvision escritorio","time_offset_sec":null,"custom_type":"positive"},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":9,"agent_key":"contagem chegando escritorio","prompt_template":"Conte quantas pessoas visivelmente entraram no escritorio.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4},{"id":6,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.","params":"{}","input_schema":"{}","camera_id":3}],"alerts":[]},{"step":{"id":4,"step_order":3,"name":"test final","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"positive","from_step_id":3,"camera_id":null,"extract":"result","pattern":"mibo","time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]},{"step":{"id":5,"step_order":4,"name":"teste final 2","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0,"time_hhmm":"12:35"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-07 20:11:05.009	2026-02-07 20:11:14.773
42	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-07T20:25:34.373Z","reason":"user_stop_from_dashboard","camera_ids":[2,3]}	sent	\N	2026-02-07 20:25:34.373	2026-02-07 20:25:47.932
72	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"17:34","schedule_mode":"weekly","schedule_day":{"id":191,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":191,"start_time":"17:34","end_time":"23:00"},"triggered_at_utc":"2026-02-08T20:34:05.005Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-08 20:34:05	2026-02-08 20:34:05.979
94	local:1	5	add_camera	{"id":5,"user_id":"local:1","name":"Webcam test wabcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":0,"is_service_running":0,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-09T16:34:36.421Z","updated_at":"2026-02-09T16:34:36.421Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":2,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"plus"}	sent	\N	2026-02-09 13:34:36.422883	2026-02-09 16:34:43.778
120	local:1	7	add_camera	{"id":7,"user_id":"local:1","name":"Webcam USB webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":0,"is_service_running":0,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-10T12:25:31.248Z","updated_at":"2026-02-10T12:25:31.248Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":1,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"plus"}	sent	\N	2026-02-10 09:25:31.251957	2026-02-10 12:25:41.369
43	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-07","local_time":"17:28","schedule_mode":"weekly","schedule_day":{"id":78,"day_name":"Saturday","day_of_week":6,"day_of_month":null,"month_of_year":null},"window":{"id":78,"start_time":"17:28","end_time":"23:00"},"triggered_at_utc":"2026-02-07T20:28:05.021Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":2,"camera_id":null,"extract":"if X happen...","pattern":"hikvision escritorio","time_offset_sec":null},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":9,"agent_key":"contagem chegando escritorio","prompt_template":"Conte quantas pessoas visivelmente entraram no escritorio.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4},{"id":6,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.","params":"{}","input_schema":"{}","camera_id":3}],"alerts":[]},{"step":{"id":4,"step_order":3,"name":"test final","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"positive","from_step_id":3,"camera_id":null,"extract":"result","pattern":"mibo","time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]},{"step":{"id":5,"step_order":4,"name":"teste final 2","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0,"time_hhmm":"12:35"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-07 20:28:05.008	2026-02-07 20:28:18.465
44	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-07T20:31:26.038Z","reason":"user_stop_from_dashboard","camera_ids":[3,2]}	sent	\N	2026-02-07 20:31:26.038	2026-02-07 20:31:34.218
201	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T23:04:28.511Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 23:04:28.511	2026-02-13 23:04:29.921
297	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-18T23:14:24.876Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-18 23:14:24.876	2026-02-18 23:14:26.777
67	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"15:48","schedule_mode":"weekly","schedule_day":{"id":170,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":170,"start_time":"15:48","end_time":"23:00"},"triggered_at_utc":"2026-02-08T18:48:05.011Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 18:48:05.006	2026-02-08 18:48:11.485
45	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-07","local_time":"17:41","schedule_mode":"weekly","schedule_day":{"id":85,"day_name":"Saturday","day_of_week":6,"day_of_month":null,"month_of_year":null},"window":{"id":85,"start_time":"17:41","end_time":"23:00"},"triggered_at_utc":"2026-02-07T20:41:05.014Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":null},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":null}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":2,"camera_id":null,"extract":"if X happen...","pattern":"hikvision escritorio","time_offset_sec":null},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":11,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"pessoas > 0"},{"id":10,"agent_key":"contagem chegada escritorio","prompt_template":"conte quantas pessoas visivelmente entraram no escritorio\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"pessoas > 0"}],"alerts":[]},{"step":{"id":4,"step_order":3,"name":"test final","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"positive","from_step_id":3,"camera_id":null,"extract":"result","pattern":"mibo","time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]},{"step":{"id":5,"step_order":4,"name":"teste final 2","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0,"time_hhmm":"12:35"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-07 20:41:05.002	2026-02-07 20:41:19.299
46	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-07T21:34:10.165Z","reason":"user_stop_from_dashboard","camera_ids":[3,2]}	sent	\N	2026-02-07 21:34:10.165	2026-02-07 21:34:14.472
73	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T20:35:11.326Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-08 20:35:11.326	2026-02-08 20:35:21.111
95	local:1	6	add_camera	{"id":6,"user_id":"local:1","name":"Webcam test webcam 2","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":0,"is_service_running":0,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-09T16:34:54.839Z","updated_at":"2026-02-09T16:34:54.839Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":2,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"plus"}	sent	\N	2026-02-09 13:34:54.841516	2026-02-09 16:34:58.788
121	local:1	7	update_camera	{"id":7,"user_id":"local:1","name":"Webcam USB webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":0,"is_service_running":1,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-10T12:25:31.248Z","updated_at":"2026-02-10T12:25:39.877Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":1,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-10 09:25:39.879291	2026-02-10 12:25:41.369
47	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"08:13","schedule_mode":"weekly","schedule_day":{"id":86,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":86,"start_time":"08:13","end_time":"23:00"},"triggered_at_utc":"2026-02-08T11:13:05.022Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":null},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":null}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":2,"camera_id":null,"extract":"if X happen...","pattern":"hikvision escritorio","time_offset_sec":null},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":11,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"pessoas > 0"},{"id":10,"agent_key":"contagem chegada escritorio","prompt_template":"conte quantas pessoas visivelmente entraram no escritorio\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"pessoas > 0"}],"alerts":[]},{"step":{"id":4,"step_order":3,"name":"test final","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":3,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]},{"step":{"id":5,"step_order":4,"name":"teste final 2","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":15720,"time_hhmm":"12:35"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 11:13:05.011	2026-02-08 11:13:14.915
48	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-08T11:13:52.090Z","reason":"user_stop_from_dashboard","camera_ids":[3,2]}	sent	\N	2026-02-08 11:13:52.09	2026-02-08 11:14:00.045
203	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T23:07:32.668Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 23:07:32.668	2026-02-13 23:07:45.643
49	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"08:51","schedule_mode":"weekly","schedule_day":{"id":93,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":93,"start_time":"08:51","end_time":"23:00"},"triggered_at_utc":"2026-02-08T11:51:05.005Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":null},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":null}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":2,"camera_id":null,"extract":"if X happen...","pattern":"hikvision escritorio","time_offset_sec":null},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":11,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"pessoas > 0"},{"id":10,"agent_key":"contagem chegada escritorio","prompt_template":"conte quantas pessoas visivelmente entraram no escritorio\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"pessoas > 0"}],"alerts":[]},{"step":{"id":4,"step_order":3,"name":"test final","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":3,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]},{"step":{"id":5,"step_order":4,"name":"teste final 2","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":13440,"time_hhmm":"12:35"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 11:51:05.001	2026-02-08 11:51:10.564
78	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"09:24","schedule_mode":"weekly","schedule_day":{"id":199,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":199,"start_time":"09:24","end_time":"17:00"},"triggered_at_utc":"2026-02-09T12:24:05.041Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 12:24:05.021	2026-02-09 12:24:13.66
50	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-08T12:27:46.959Z","reason":"user_stop_from_dashboard","camera_ids":[3,2]}	sent	\N	2026-02-08 12:27:46.959	2026-02-08 12:27:48.132
97	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T17:10:52.441Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 17:10:52.441	2026-02-09 17:11:06.068
52	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T12:37:25.138Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-08 12:37:25.138	2026-02-08 12:37:34.876
122	local:1	7	start_camera	{"camera_id":7,"name":"Webcam USB webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":1,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}	sent	\N	2026-02-10 12:25:39.876	2026-02-10 12:25:41.369
53	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"09:59","schedule_mode":"weekly","schedule_day":{"id":114,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":114,"start_time":"09:59","end_time":"23:00"},"triggered_at_utc":"2026-02-08T12:59:05.027Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":6,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 12:59:05.022	2026-02-08 12:59:09.446
68	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"16:17","schedule_mode":"weekly","schedule_day":{"id":177,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":177,"start_time":"16:17","end_time":"23:00"},"triggered_at_utc":"2026-02-08T19:17:05.029Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-08 19:17:05.024	2026-02-08 19:17:15.451
298	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-18","local_time":"20:23","schedule_mode":"weekly","schedule_day":{"id":829,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":829,"start_time":"20:23","end_time":"23:00"},"triggered_at_utc":"2026-02-18T23:23:05.016Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771454268486-499","name":"grupo teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":22,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-18 23:23:05.005	2026-02-18 23:23:16.533
54	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"10:25","schedule_mode":"weekly","schedule_day":{"id":121,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":121,"start_time":"10:25","end_time":"23:00"},"triggered_at_utc":"2026-02-08T13:25:05.016Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":6,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 13:25:05.01	2026-02-08 13:25:09.273
55	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T13:27:03.912Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-08 13:27:03.912	2026-02-08 13:27:09.548
79	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T12:26:19.945Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 12:26:19.945	2026-02-09 12:26:29.062
56	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"10:34","schedule_mode":"weekly","schedule_day":{"id":128,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":128,"start_time":"10:34","end_time":"23:00"},"triggered_at_utc":"2026-02-08T13:34:05.014Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":6,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 13:34:05.007	2026-02-08 13:34:10.439
57	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"10:42","schedule_mode":"weekly","schedule_day":{"id":135,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":135,"start_time":"10:42","end_time":"23:00"},"triggered_at_utc":"2026-02-08T13:42:05.017Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":6,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 13:42:05.011	2026-02-08 13:42:11.527
81	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T12:30:48.239Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 12:30:48.239	2026-02-09 12:30:49.116
58	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T13:43:19.026Z","reason":"user_stop_from_dashboard","camera_ids":[3]}	sent	\N	2026-02-08 13:43:19.026	2026-02-08 13:43:26.684
99	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T23:06:54.378Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 23:06:54.378	2026-02-09 23:07:02.412
59	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"11:27","schedule_mode":"weekly","schedule_day":{"id":142,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":142,"start_time":"11:27","end_time":"23:00"},"triggered_at_utc":"2026-02-08T14:27:05.039Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":120,"time_hhmm":"11:29"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 14:27:05.019	2026-02-08 14:27:08.437
69	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T19:18:38.248Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-08 19:18:38.248	2026-02-08 19:18:45.586
60	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-08T14:30:02.394Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-08 14:30:02.394	2026-02-08 14:30:08.943
205	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T23:17:13.792Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 23:17:13.792	2026-02-13 23:17:22.826
61	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-08","local_time":"11:48","schedule_mode":"weekly","schedule_day":{"id":149,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":149,"start_time":"11:48","end_time":"23:00"},"triggered_at_utc":"2026-02-08T14:48:05.052Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":120,"time_hhmm":"11:50"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":60,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":false,"telegram_chat_id":"","telegram_bot_token":""}}}	sent	\N	2026-02-08 14:48:05.045	2026-02-08 14:48:17.138
74	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"09:00","schedule_mode":"weekly","schedule_day":{"id":94,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":94,"start_time":"09:00","end_time":"17:00"},"triggered_at_utc":"2026-02-09T12:00:05.027Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":null},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":null}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":2,"camera_id":null,"extract":"if X happen...","pattern":"hikvision escritorio","time_offset_sec":null},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":11,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"pessoas > 0"},{"id":10,"agent_key":"contagem chegada escritorio","prompt_template":"conte quantas pessoas visivelmente entraram no escritorio\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"pessoas > 0"}],"alerts":[]},{"step":{"id":4,"step_order":3,"name":"test final","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":3,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]},{"step":{"id":5,"step_order":4,"name":"teste final 2","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":12900,"time_hhmm":"12:35"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 12:00:05.022	2026-02-09 12:00:09.857
83	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T13:01:08.008Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 13:01:08.008	2026-02-09 13:01:13.007
101	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-10T00:05:42.100Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-10 00:05:42.1	2026-02-10 00:05:42.842
123	local:1	7	update_camera	{"id":7,"user_id":"local:1","name":"Webcam USB webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_7_1770726342742.jpg","last_thumbnail_update":"2026-02-10T15:25:42.743Z","created_at":"2026-02-10T12:25:31.248Z","updated_at":"2026-02-10T12:25:52.852Z","store_frames":1,"retention_days":1,"description":"LABEL: other_indoor\\nDESCRIPTION: The environment appears to be dark with no visible features.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":1,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-10 09:25:52.856153	2026-02-10 12:25:56.385
124	local:1	7	stop_camera	{"camera_id":7}	sent	\N	2026-02-10 09:25:52.864116	2026-02-10 12:25:56.385
140	local:1	\N	job_start	{"version":1,"job":{"id":6,"user_id":"local:1","name":"Analise Recepcao SAP_C","description":"recepcao sap CE","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-10T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"14:35","schedule_mode":"weekly","schedule_day":{"id":382,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":382,"start_time":"14:35","end_time":"17:00"},"triggered_at_utc":"2026-02-10T17:35:05.021Z"},"steps":[{"step":{"id":12,"step_order":1,"name":"Passagem RAIO X","timeout_seconds":5000,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":14,"camera_id":8,"camera_name":"SAP_C: Recepcao 2"}],"agents":[{"id":28,"agent_key":"Mochila Raio X","prompt_template":"Informe quando uma pessoa passar pela maquina/bolsa/sacola/pacote de Raio X vinda da recepcao no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)\\n\\nalert_condition: Uma pessoa deve ter passado pela maquina de raio x com uma maquina/bolsa/sacola/pacote vinda da recepcao no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)","params":"{}","input_schema":"{}","camera_id":8,"alert_condition":"Uma pessoa deve ter passado pela maquina de raio x com uma maquina/bolsa/sacola/pacote vinda da recepcao no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)","priority_level":"HIGH"}],"alerts":[{"id":4,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]}],"all_camera_ids":[8],"start_camera_payloads":{"8":{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 17:35:05.004	2026-02-10 17:35:15.389
80	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"09:30","schedule_mode":"weekly","schedule_day":{"id":206,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":206,"start_time":"09:30","end_time":"17:00"},"triggered_at_utc":"2026-02-09T12:30:05.034Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 12:30:05.02	2026-02-09 12:30:19.055
82	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"10:00","schedule_mode":"weekly","schedule_day":{"id":213,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":213,"start_time":"10:00","end_time":"17:00"},"triggered_at_utc":"2026-02-09T13:00:05.017Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 13:00:05.006	2026-02-09 13:00:12.923
85	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-09T14:30:27.664Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-09 14:30:27.664	2026-02-09 14:30:40.292
103	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-10T00:50:27.438Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-10 00:50:27.438	2026-02-10 00:50:37.166
125	local:1	4	update_camera	{"id":4,"user_id":"local:1","name":"Webcam webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":0,"is_service_running":1,"thumbnail_url":"user_local:1_camera_4_1770726131269.jpg","last_thumbnail_update":"2026-02-10T15:22:11.276Z","created_at":"2026-02-06T21:35:32.055Z","updated_at":"2026-02-10T12:25:58.312Z","store_frames":1,"retention_days":1,"description":"LABEL: other_indoor\\nDESCRIPTION: The environment is dark.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":0,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-10 09:25:58.312492	2026-02-10 12:26:11.851
126	local:1	4	start_camera	{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}	sent	\N	2026-02-10 12:25:58.302	2026-02-10 12:26:11.851
84	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"11:29","schedule_mode":"weekly","schedule_day":{"id":220,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":220,"start_time":"11:29","end_time":"17:00"},"triggered_at_utc":"2026-02-09T14:29:05.035Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 14:29:05.021	2026-02-09 14:29:10.162
141	local:1	\N	job_stop	{"job":{"id":6,"name":"Analise Recepcao SAP_C"},"requested_at_utc":"2026-02-10T17:37:50.092Z","reason":"user_stop_from_dashboard","camera_ids":[8]}	sent	\N	2026-02-10 17:37:50.092	2026-02-10 17:38:00.764
86	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"13:11","schedule_mode":"weekly","schedule_day":{"id":227,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":227,"start_time":"13:11","end_time":"17:00"},"triggered_at_utc":"2026-02-09T16:11:05.041Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 16:11:05.02	2026-02-09 16:11:19.514
207	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-14T15:40:06.317Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-14 15:40:06.317	2026-02-14 15:40:09.85
299	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-18T23:24:39.443Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-18 23:24:39.443	2026-02-18 23:24:46.677
148	local:1	\N	job_start	{"version":1,"job":{"id":6,"user_id":"local:1","name":"Analise Recepcao SAP_C","description":"recepcao sap CE","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-10T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"15:01","schedule_mode":"weekly","schedule_day":{"id":410,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":410,"start_time":"15:01","end_time":"17:00"},"triggered_at_utc":"2026-02-10T18:01:05.019Z"},"steps":[{"step":{"id":12,"step_order":1,"name":"Passagem RAIO X","timeout_seconds":5000,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":14,"camera_id":8,"camera_name":"SAP_C: Recepcao 2"}],"agents":[{"id":28,"agent_key":"Mochila Raio X","prompt_template":"Informe quando uma pessoa carregando uma mochila/bolsa/sacola/pacote passar da area norte parra a area sul da recepcao atraves do portal de raio x (por debaixo do portal - aonde tem escrito GARRETT em amarelo). Ignore pessoas de costas mesmo com mochila/bolsa/sacola/pacote passando por debaixo do portal.\\n\\nalert_condition: quando uma pessoa carregando uma mochila/bolsa/sacola/pacote passar da area norte parra a area sul da recepcao atraves do portal de raio x (por debaixo do portal - aonde tem escrito GARRETT em amarelo).","params":"{}","input_schema":"{}","camera_id":8,"alert_condition":"quando uma pessoa carregando uma mochila/bolsa/sacola/pacote passar da area norte parra a area sul da recepcao atraves do portal de raio x (por debaixo do portal - aonde tem escrito GARRETT em amarelo).","priority_level":"CRITIC"}],"alerts":[{"id":4,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]}],"all_camera_ids":[8],"start_camera_payloads":{"8":{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 18:01:05.014	2026-02-10 18:01:10.705
105	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-10T10:38:29.154Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-10 10:38:29.154	2026-02-10 10:38:32.346
127	local:1	4	update_camera	{"id":4,"user_id":"local:1","name":"Webcam webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_4_1770726372834.jpg","last_thumbnail_update":"2026-02-10T15:26:12.837Z","created_at":"2026-02-06T21:35:32.055Z","updated_at":"2026-02-10T12:26:29.595Z","store_frames":1,"retention_days":1,"description":"LABEL: other_indoor\\nDESCRIPTION: The environment is dark.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":0,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-10 09:26:29.59983	2026-02-10 12:26:41.931
128	local:1	4	stop_camera	{"camera_id":4}	sent	\N	2026-02-10 09:26:29.610197	2026-02-10 12:26:41.931
88	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"13:17","schedule_mode":"weekly","schedule_day":{"id":248,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":248,"start_time":"13:17","end_time":"17:00"},"triggered_at_utc":"2026-02-09T16:17:05.067Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 16:17:05.042	2026-02-09 16:17:08.038
142	local:1	\N	job_start	{"version":1,"job":{"id":6,"user_id":"local:1","name":"Analise Recepcao SAP_C","description":"recepcao sap CE","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-10T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"14:43","schedule_mode":"weekly","schedule_day":{"id":389,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":389,"start_time":"14:43","end_time":"17:00"},"triggered_at_utc":"2026-02-10T17:43:05.006Z"},"steps":[{"step":{"id":12,"step_order":1,"name":"Passagem RAIO X","timeout_seconds":5000,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":14,"camera_id":8,"camera_name":"SAP_C: Recepcao 2"}],"agents":[{"id":28,"agent_key":"Mochila Raio X","prompt_template":"Informe quando uma pessoa passar atraves da maquina de raio x (por dentro do portal - GARRETT)  carregando uma mochila/bolsa/sacola/pacote, vinda da recepcao no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)\\n\\nalert_condition: Uma pessoa deve ter passado atraves da maquina de raio x (por dentro do portal - GARRETT) carregando uma maquina/bolsa/sacola/pacote, vinda da recepcao no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)","params":"{}","input_schema":"{}","camera_id":8,"alert_condition":"Uma pessoa deve ter passado atraves da maquina de raio x (por dentro do portal - GARRETT) carregando uma maquina/bolsa/sacola/pacote, vinda da recepcao no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)","priority_level":"CRITIC"}],"alerts":[{"id":4,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]}],"all_camera_ids":[8],"start_camera_payloads":{"8":{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 17:43:05.002	2026-02-10 17:43:19.066
90	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"13:20","schedule_mode":"weekly","schedule_day":{"id":255,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":255,"start_time":"13:20","end_time":"17:00"},"triggered_at_utc":"2026-02-09T16:20:05.049Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 16:20:05.037	2026-02-09 16:20:09.808
107	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-10T11:03:45.482Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-10 11:03:45.482	2026-02-10 11:03:55.53
92	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"13:26","schedule_mode":"weekly","schedule_day":{"id":262,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":262,"start_time":"13:26","end_time":"17:00"},"triggered_at_utc":"2026-02-09T16:26:05.019Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 16:26:05.012	2026-02-09 16:26:12.029
143	local:1	\N	job_stop	{"job":{"id":6,"name":"Analise Recepcao SAP_C"},"requested_at_utc":"2026-02-10T17:45:46.297Z","reason":"user_stop_from_dashboard","camera_ids":[8]}	sent	\N	2026-02-10 17:45:46.297	2026-02-10 17:45:49.381
96	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-09","local_time":"14:10","schedule_mode":"weekly","schedule_day":{"id":269,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":269,"start_time":"14:10","end_time":"17:00"},"triggered_at_utc":"2026-02-09T17:10:05.050Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":12,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":13,"agent_key":"pessoa finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 17:10:05.032	2026-02-09 17:10:05.954
109	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-10T11:12:15.178Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-10 11:12:15.178	2026-02-10 11:12:18.012
150	local:1	\N	job_start	{"version":1,"job":{"id":6,"user_id":"local:1","name":"Analise Recepcao SAP_C","description":"recepcao sap CE","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-10T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"15:08","schedule_mode":"weekly","schedule_day":{"id":417,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":417,"start_time":"15:08","end_time":"17:00"},"triggered_at_utc":"2026-02-10T18:08:05.023Z"},"steps":[{"step":{"id":12,"step_order":1,"name":"Passagem RAIO X","timeout_seconds":5000,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":14,"camera_id":8,"camera_name":"SAP_C: Recepcao 2"}],"agents":[{"id":28,"agent_key":"Mochila Raio X","prompt_template":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).\\n\\nDefinições visuais do cenário:\\n\\nPortal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.\\n\\nLinha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.\\n\\nSentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).\\n\\nSentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.\\n\\nRegra obrigatória de orientação (anti-falso-positivo):\\n\\nSó gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.\\n\\n“De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.\\n\\nSe a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.\\n\\nO que conta como item carregado:\\n\\nMochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.\\n\\nSe estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.\\n\\nalert_condition: Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).  Definições visuais do cenário:  Portal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.  Linha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.  Sentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).  Sentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.  Regra obrigatória de orientação (anti-falso-positivo):  Só gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.  “De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.  Se a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.  O que conta como item carregado:  Mochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.  Se estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.","params":"{}","input_schema":"{}","camera_id":8,"alert_condition":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).  Definições visuais do cenário:  Portal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.  Linha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.  Sentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).  Sentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.  Regra obrigatória de orientação (anti-falso-positivo):  Só gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.  “De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.  Se a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.  O que conta como item carregado:  Mochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.  Se estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.","priority_level":"CRITIC"}],"alerts":[{"id":4,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]}],"all_camera_ids":[8],"start_camera_payloads":{"8":{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 18:08:05.017	2026-02-10 18:08:05.807
130	local:1	4	update_camera	{"id":4,"user_id":"local:1","name":"Webcam webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":1,"is_service_running":1,"thumbnail_url":"user_local:1_camera_4_1770726372834.jpg","last_thumbnail_update":"2026-02-10T15:26:12.837Z","created_at":"2026-02-06T21:35:32.055Z","updated_at":"2026-02-10T12:26:54.861Z","store_frames":1,"retention_days":1,"description":"LABEL: other_indoor\\nDESCRIPTION: The environment is dark.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":0,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-10 09:26:54.864897	2026-02-10 12:26:57.464
131	local:1	4	start_camera	{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}	sent	\N	2026-02-10 12:26:54.884	2026-02-10 12:26:57.464
154	local:1	\N	job_start	{"version":1,"job":{"id":6,"user_id":"local:1","name":"Analise Recepcao SAP_C","description":"recepcao sap CE","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-10T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-11","local_time":"10:41","schedule_mode":"weekly","schedule_day":{"id":432,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":432,"start_time":"10:41","end_time":"17:00"},"triggered_at_utc":"2026-02-11T13:41:05.035Z"},"steps":[{"step":{"id":12,"step_order":1,"name":"Passagem RAIO X","timeout_seconds":5000,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":14,"camera_id":8,"camera_name":"SAP_C: Recepcao 2"}],"agents":[{"id":28,"agent_key":"Mochila Raio X","prompt_template":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).\\n\\nDefinições visuais do cenário:\\n\\nPortal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.\\n\\nLinha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco.\\n\\nSentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e lixeira preta pequena).\\n\\n\\nSentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.\\n\\nRegra obrigatória de orientação (anti-falso-positivo):\\n\\nSó gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.\\n\\n“De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.\\n\\nSe a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.\\n\\nO que conta como item carregado:\\n\\nMochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.\\n\\nSe estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.\\n\\nalert_condition: alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).","params":"{}","input_schema":"{}","camera_id":8,"alert_condition":"alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).","priority_level":"HIGH"}],"alerts":[{"id":4,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]}],"all_camera_ids":[8],"start_camera_payloads":{"8":{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-11 13:41:05.01	2026-02-11 13:41:14.146
98	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-09","local_time":"20:05","schedule_mode":"weekly","schedule_day":{"id":276,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":276,"start_time":"20:05","end_time":"23:00"},"triggered_at_utc":"2026-02-09T23:05:05.019Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":23,"agent_key":"torcedor finder","prompt_template":"procure por pessoas com camisa de time de futebol\\n\\nalert_condition: se achar alguem com camisa de time","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa de time","priority_level":"CRITIC"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-09 23:05:05.003	2026-02-09 23:05:17.187
209	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-15T12:39:24.255Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-15 12:39:24.255	2026-02-15 12:39:27.699
144	local:1	\N	job_start	{"version":1,"job":{"id":6,"user_id":"local:1","name":"Analise Recepcao SAP_C","description":"recepcao sap CE","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-10T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"14:47","schedule_mode":"weekly","schedule_day":{"id":396,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":396,"start_time":"14:47","end_time":"17:00"},"triggered_at_utc":"2026-02-10T17:47:05.007Z"},"steps":[{"step":{"id":12,"step_order":1,"name":"Passagem RAIO X","timeout_seconds":5000,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":14,"camera_id":8,"camera_name":"SAP_C: Recepcao 2"}],"agents":[{"id":28,"agent_key":"Mochila Raio X","prompt_template":"Informe quando uma pessoa passar de frente atraves da maquina de raio x (por dentro do portal - GARRETT) carregando uma mochila/bolsa/sacola/pacote, vinda da recepcao no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)\\n\\nalert_condition: Uma pessoa deve ter passado de frente atraves da maquina de raio x (por dentro do portal - GARRETT) carregando uma maquina/bolsa/sacola/pacote, vinda da recepcao no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)","params":"{}","input_schema":"{}","camera_id":8,"alert_condition":"Uma pessoa deve ter passado de frente atraves da maquina de raio x (por dentro do portal - GARRETT) carregando uma maquina/bolsa/sacola/pacote, vinda da recepcao no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)","priority_level":"CRITIC"}],"alerts":[{"id":4,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]}],"all_camera_ids":[8],"start_camera_payloads":{"8":{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 17:47:05.003	2026-02-10 17:47:19.902
100	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-09","local_time":"21:04","schedule_mode":"weekly","schedule_day":{"id":304,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":304,"start_time":"21:04","end_time":"23:00"},"triggered_at_utc":"2026-02-10T00:04:05.019Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":23,"agent_key":"white shirt finder","prompt_template":"procure por pessoas com camisa ou blusa branca\\n\\nalert_condition: se achar alguem com camisa ou blusa branca","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa ou blusa branca","priority_level":"CRITIC"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 00:04:05.005	2026-02-10 00:04:12.75
111	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-10T11:21:38.825Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-10 11:21:38.825	2026-02-10 11:21:44.239
151	local:1	\N	job_stop	{"job":{"id":6,"name":"Analise Recepcao SAP_C"},"requested_at_utc":"2026-02-10T18:12:21.892Z","reason":"user_stop_from_dashboard","camera_ids":[8]}	sent	\N	2026-02-10 18:12:21.892	2026-02-10 18:12:36.334
132	local:1	4	update_camera	{"id":4,"user_id":"local:1","name":"Webcam webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_4_1770726418756.jpg","last_thumbnail_update":"2026-02-10T15:26:58.758Z","created_at":"2026-02-06T21:35:32.055Z","updated_at":"2026-02-10T12:27:12.994Z","store_frames":1,"retention_days":1,"description":"LABEL: other_indoor\\nDESCRIPTION: The environment is dark.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":0,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-10 09:27:12.998725	2026-02-10 12:27:27.535
133	local:1	4	stop_camera	{"camera_id":4}	sent	\N	2026-02-10 09:27:13.008079	2026-02-10 12:27:27.535
155	local:1	\N	job_stop	{"job":{"id":6,"name":"Analise Recepcao SAP_C"},"requested_at_utc":"2026-02-11T13:46:13.629Z","reason":"user_stop_from_dashboard","camera_ids":[8]}	sent	\N	2026-02-11 13:46:13.629	2026-02-11 13:46:14.838
102	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-09","local_time":"21:50","schedule_mode":"weekly","schedule_day":{"id":318,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":318,"start_time":"21:50","end_time":"23:00"},"triggered_at_utc":"2026-02-10T00:50:05.049Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":23,"agent_key":"white shirt finder","prompt_template":"procure por pessoas com camisa ou blusa branca\\n\\nalert_condition: se achar alguem com camisa ou blusa branca","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem com camisa ou blusa branca","priority_level":"CRITIC"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 00:50:05.033	2026-02-10 00:50:07.104
145	local:1	\N	job_stop	{"job":{"id":6,"name":"Analise Recepcao SAP_C"},"requested_at_utc":"2026-02-10T17:50:12.504Z","reason":"user_stop_from_dashboard","camera_ids":[8]}	sent	\N	2026-02-10 17:50:12.504	2026-02-10 17:50:20.33
211	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-15T13:03:49.445Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-15 13:03:49.445	2026-02-15 13:04:03.622
104	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"07:34","schedule_mode":"weekly","schedule_day":{"id":326,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":326,"start_time":"07:34","end_time":"17:00"},"triggered_at_utc":"2026-02-10T10:34:05.031Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":23,"agent_key":"xicara branca finder","prompt_template":"procure por pessoas segurando uma xicara branca\\n\\nalert_condition: se achar alguem segurando uma xicara branca","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem segurando uma xicara branca","priority_level":"CRITIC"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 10:34:05.013	2026-02-10 10:34:16.48
113	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-10T11:30:35.093Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-10 11:30:35.093	2026-02-10 11:30:46.122
152	local:1	\N	job_start	{"version":1,"job":{"id":6,"user_id":"local:1","name":"Analise Recepcao SAP_C","description":"recepcao sap CE","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-10T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"15:15","schedule_mode":"weekly","schedule_day":{"id":424,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":424,"start_time":"15:15","end_time":"17:00"},"triggered_at_utc":"2026-02-10T18:15:05.009Z"},"steps":[{"step":{"id":12,"step_order":1,"name":"Passagem RAIO X","timeout_seconds":5000,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":14,"camera_id":8,"camera_name":"SAP_C: Recepcao 2"}],"agents":[{"id":28,"agent_key":"Mochila Raio X","prompt_template":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).\\n\\nDefinições visuais do cenário:\\n\\nPortal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.\\n\\nLinha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.\\n\\nSentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).\\n\\nSentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.\\n\\nRegra obrigatória de orientação (anti-falso-positivo):\\n\\nSó gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.\\n\\n“De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.\\n\\nSe a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.\\n\\nO que conta como item carregado:\\n\\nMochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.\\n\\nSe estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.\\n\\nalert_condition: Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).  Definições visuais do cenário:  Portal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.  Linha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.  Sentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).  Sentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.  Regra obrigatória de orientação (anti-falso-positivo):  Só gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.  “De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.  Se a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.  O que conta como item carregado:  Mochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.  Se estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.","params":"{}","input_schema":"{}","camera_id":8,"alert_condition":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).  Definições visuais do cenário:  Portal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.  Linha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.  Sentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).  Sentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.  Regra obrigatória de orientação (anti-falso-positivo):  Só gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.  “De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.  Se a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.  O que conta como item carregado:  Mochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.  Se estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.","priority_level":"CRITIC"}],"alerts":[{"id":4,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]}],"all_camera_ids":[8],"start_camera_payloads":{"8":{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 18:15:05.005	2026-02-10 18:15:06.961
134	local:1	8	add_camera	{"id":8,"user_id":"local:1","name":"SAP_C: Recepcao 2","ip_address":"10.18.4.96","rtsp_port":"554","manufacturer":"Intelbras","username":"admin","password":"ADMcoint2025","connection_method":"RTSP","is_online":0,"is_service_running":0,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-10T17:23:56.887Z","updated_at":"2026-02-10T17:23:56.887Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":3,"model_tier":"plus"}	sent	\N	2026-02-10 14:23:56.894677	2026-02-10 17:23:59.192
106	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"08:03","schedule_mode":"weekly","schedule_day":{"id":333,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":333,"start_time":"08:03","end_time":"17:00"},"triggered_at_utc":"2026-02-10T11:03:05.022Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":23,"agent_key":"xicara branca finder","prompt_template":"procure por pessoas segurando uma xicara branca\\n\\nalert_condition: se achar alguem segurando uma xicara branca","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem segurando uma xicara branca","priority_level":"CRITIC"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 11:03:05.007	2026-02-10 11:03:10.385
108	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"08:11","schedule_mode":"weekly","schedule_day":{"id":340,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":340,"start_time":"08:11","end_time":"17:00"},"triggered_at_utc":"2026-02-10T11:11:05.017Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":23,"agent_key":"xicara branca finder","prompt_template":"procure por pessoas segurando uma xicara branca\\n\\nalert_condition: se achar alguem segurando uma xicara branca","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem segurando uma xicara branca","priority_level":"CRITIC"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 11:11:05.014	2026-02-10 11:11:17.91
153	local:1	\N	job_stop	{"job":{"id":6,"name":"Analise Recepcao SAP_C"},"requested_at_utc":"2026-02-10T18:16:16.341Z","reason":"user_stop_from_dashboard","camera_ids":[8]}	sent	\N	2026-02-10 18:16:16.341	2026-02-10 18:16:22.119
115	local:1	\N	job_stop	{"job":{"id":3,"name":"Contagem"},"requested_at_utc":"2026-02-10T12:03:00.797Z","reason":"user_stop_from_dashboard","camera_ids":[2,3]}	sent	\N	2026-02-10 12:03:00.797	2026-02-10 12:03:07.171
135	local:1	8	update_camera	{"id":8,"user_id":"local:1","name":"SAP_C: Recepcao 2","ip_address":"10.18.4.96","rtsp_port":"554","manufacturer":"Intelbras","username":"admin","password":"ADMcoint2025","connection_method":"RTSP","is_online":0,"is_service_running":1,"thumbnail_url":null,"last_thumbnail_update":null,"created_at":"2026-02-10T17:23:56.887Z","updated_at":"2026-02-10T17:24:13.760Z","store_frames":1,"retention_days":1,"description":"","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-10 14:24:13.763451	2026-02-10 17:24:14.21
136	local:1	8	start_camera	{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}	sent	\N	2026-02-10 17:24:13.775	2026-02-10 17:24:14.21
146	local:1	\N	job_start	{"version":1,"job":{"id":6,"user_id":"local:1","name":"Analise Recepcao SAP_C","description":"recepcao sap CE","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-10T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"14:53","schedule_mode":"weekly","schedule_day":{"id":403,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":403,"start_time":"14:53","end_time":"17:00"},"triggered_at_utc":"2026-02-10T17:53:05.154Z"},"steps":[{"step":{"id":12,"step_order":1,"name":"Passagem RAIO X","timeout_seconds":5000,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":14,"camera_id":8,"camera_name":"SAP_C: Recepcao 2"}],"agents":[{"id":28,"agent_key":"Mochila Raio X","prompt_template":"Informe quando uma pessoa carregando uma mochila/bolsa/sacola/pacote passar de frente (rosto virado para a camera) atraves do portal de raio x (por dentro do portal - aonde tem escrito GARRETT em amarelo) , vinda da recepcao (aonde tem as motos) no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)\\n\\nalert_condition: quando uma pessoa carregando uma mochila/bolsa/sacola/pacote passar de frente (rosto virado para a camera) atraves do portal de raio x (por dentro do portal - aonde tem escrito GARRETT em amarelo) , vinda da recepcao (aonde tem as motos) no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)","params":"{}","input_schema":"{}","camera_id":8,"alert_condition":"quando uma pessoa carregando uma mochila/bolsa/sacola/pacote passar de frente (rosto virado para a camera) atraves do portal de raio x (por dentro do portal - aonde tem escrito GARRETT em amarelo) , vinda da recepcao (aonde tem as motos) no sentido da bancada de saida do raio X (Mais proximo do primeiro plano da camera)","priority_level":"CRITIC"}],"alerts":[{"id":4,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]}],"all_camera_ids":[8],"start_camera_payloads":{"8":{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 17:53:05.147	2026-02-10 17:53:06.271
110	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"08:21","schedule_mode":"weekly","schedule_day":{"id":347,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":347,"start_time":"08:21","end_time":"17:00"},"triggered_at_utc":"2026-02-10T11:21:05.017Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":23,"agent_key":"xicara branca finder","prompt_template":"procure por pessoas segurando uma xicara branca\\n\\nalert_condition: se achar alguem segurando uma xicara branca","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar alguem segurando uma xicara branca","priority_level":"CRITIC"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 11:21:05.008	2026-02-10 11:21:14.182
112	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"08:30","schedule_mode":"weekly","schedule_day":{"id":354,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":354,"start_time":"08:30","end_time":"17:00"},"triggered_at_utc":"2026-02-10T11:30:05.021Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 11:30:05.012	2026-02-10 11:30:16.041
117	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-10T12:22:24.477Z","reason":"user_stop_from_dashboard","camera_ids":[4]}	sent	\N	2026-02-10 12:22:24.477	2026-02-10 12:22:25.344
114	local:1	\N	job_start	{"version":1,"job":{"id":3,"user_id":"local:1","name":"Contagem","description":"Contagem","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-06T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-10","local_time":"09:00","schedule_mode":"weekly","schedule_day":{"id":95,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":95,"start_time":"09:00","end_time":"17:00"},"triggered_at_utc":"2026-02-10T12:00:05.046Z"},"steps":[{"step":{"id":2,"step_order":1,"name":"Contagem pessoas ida","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":2,"camera_id":2,"camera_name":"hikvision escritorio"},{"id":3,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":3,"agent_key":"contagem chegando sala","prompt_template":"Conte quantas pessoas visivelmente entram na sala.","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":null,"priority_level":"MEDIUM"},{"id":2,"agent_key":"contagem pessoas saindo","prompt_template":"Conte quantas pessoas visivelmente sairam do escritorio.","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":null,"priority_level":"MEDIUM"}],"alerts":[]},{"step":{"id":3,"step_order":2,"name":"Contagem pessoas volta","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":2,"camera_id":null,"extract":"if X happen...","pattern":"hikvision escritorio","time_offset_sec":null},"pipeline":{"input_from_step_id":2,"input_inject_key":"mibo","camera_id":3},"pipelines":[{"input_from_step_id":2,"target_camera_id":4,"inputs":[{"input_inject_key":"mibo","camera_id":3}]}]},"targets":[{"id":4,"camera_id":3,"camera_name":"mibo"},{"id":5,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":11,"agent_key":"contagem pessoas saindo sala","prompt_template":"Conte quantas pessoas visivelmente sairam da sala.\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"pessoas > 0","priority_level":"MEDIUM"},{"id":10,"agent_key":"contagem chegada escritorio","prompt_template":"conte quantas pessoas visivelmente entraram no escritorio\\n\\nalert_condition: pessoas > 0","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"pessoas > 0","priority_level":"MEDIUM"}],"alerts":[]},{"step":{"id":4,"step_order":3,"name":"test final","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":3,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]},{"step":{"id":5,"step_order":4,"name":"teste final 2","timeout_seconds":300,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":12900,"time_hhmm":"12:35"},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[],"agents":[],"alerts":[]}],"all_camera_ids":[2,3,4],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 12:00:05.032	2026-02-10 12:00:06.658
147	local:1	\N	job_stop	{"job":{"id":6,"name":"Analise Recepcao SAP_C"},"requested_at_utc":"2026-02-10T17:56:57.152Z","reason":"user_stop_from_dashboard","camera_ids":[8]}	sent	\N	2026-02-10 17:56:57.152	2026-02-10 17:57:06.971
213	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-15T13:11:08.739Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-15 13:11:08.739	2026-02-15 13:11:10.234
116	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-10","local_time":"09:20","schedule_mode":"weekly","schedule_day":{"id":361,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":361,"start_time":"09:20","end_time":"17:00"},"triggered_at_utc":"2026-02-10T12:20:05.013Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-10 12:20:05.009	2026-02-10 12:20:10.174
156	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"07:52","schedule_mode":"weekly","schedule_day":{"id":441,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":441,"start_time":"07:52","end_time":"17:00"},"triggered_at_utc":"2026-02-13T10:52:05.025Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":29,"agent_key":"flip flop finder","prompt_template":"procure por pessoas usando chinelos.\\n\\nalert_condition: se avistar alguem de chinelo","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se avistar alguem de chinelo","priority_level":"MEDIUM"},{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.31","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 10:52:05.01	2026-02-13 10:52:07.965
164	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"08:28","schedule_mode":"weekly","schedule_day":{"id":462,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":462,"start_time":"08:28","end_time":"17:00"},"triggered_at_utc":"2026-02-13T11:28:05.009Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":29,"agent_key":"flip flop finder","prompt_template":"procure por pessoas usando chinelos.\\n\\nalert_condition: se avistar alguem de chinelo","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se avistar alguem de chinelo","priority_level":"MEDIUM"},{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 11:28:05.003	2026-02-13 11:28:14.813
215	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-16T15:25:44.855Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-16 15:25:44.855	2026-02-16 15:25:53.483
219	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T12:44:34.969Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-17 12:44:34.969	2026-02-17 12:44:42.507
157	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T10:54:28.292Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 10:54:28.292	2026-02-13 10:54:38.277
165	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T11:30:47.633Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 11:30:47.633	2026-02-13 11:31:00.539
172	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"09:05","schedule_mode":"weekly","schedule_day":{"id":483,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":483,"start_time":"09:05","end_time":"17:00"},"triggered_at_utc":"2026-02-13T12:05:05.026Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":29,"agent_key":"flip flop finder","prompt_template":"procure por pessoas usando chinelos.\\n\\nalert_condition: se avistar alguem de chinelo","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se avistar alguem de chinelo","priority_level":"MEDIUM"},{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 12:05:05.014	2026-02-13 12:05:13.714
180	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"13:04","schedule_mode":"weekly","schedule_day":{"id":511,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":511,"start_time":"13:04","end_time":"17:00"},"triggered_at_utc":"2026-02-13T16:04:04.999Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 16:04:04.992	2026-02-13 16:04:10.726
188	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"18:40","schedule_mode":"weekly","schedule_day":{"id":539,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":539,"start_time":"18:40","end_time":"23:00"},"triggered_at_utc":"2026-02-13T21:40:05.042Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 21:40:05.029	2026-02-13 21:40:11.858
217	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-16T17:19:51.404Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-16 17:19:51.404	2026-02-16 17:20:02.974
221	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T12:48:48.709Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 12:48:48.709	2026-02-17 12:48:58.726
158	local:1	3	update_camera	{"id":3,"user_id":"local:1","name":"mibo","ip_address":"192.168.0.106","rtsp_port":"554","manufacturer":"Intelbras","username":"admin","password":"Mibo2025*","connection_method":"RTSP","is_online":0,"is_service_running":0,"thumbnail_url":"user_local:1_camera_3_1770638693945.jpg","last_thumbnail_update":"2026-02-09T15:04:53.947Z","created_at":"2026-02-06T21:33:16.215Z","updated_at":"2026-02-13T10:55:03.998Z","store_frames":1,"retention_days":1,"description":"LABEL: office_room DESCRIPTION: The environment appears to be an interior space with a neutral-toned wall and a window providing an indirect light source.","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-13 07:55:04.002326	2026-02-13 10:55:08.853
166	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"08:56","schedule_mode":"weekly","schedule_day":{"id":469,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":469,"start_time":"08:56","end_time":"17:00"},"triggered_at_utc":"2026-02-13T11:56:05.012Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":29,"agent_key":"flip flop finder","prompt_template":"procure por pessoas usando chinelos.\\n\\nalert_condition: se avistar alguem de chinelo","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se avistar alguem de chinelo","priority_level":"MEDIUM"},{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 11:56:05.008	2026-02-13 11:56:05.898
173	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T12:06:00.305Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 12:06:00.305	2026-02-13 12:06:13.836
181	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T16:06:14.440Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 16:06:14.44	2026-02-13 16:06:26.023
189	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T21:42:09.636Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 21:42:09.636	2026-02-13 21:42:12.301
223	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T12:52:12.958Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 12:52:12.958	2026-02-17 12:52:15.416
278	local:1	4	update_camera	{"id":4,"user_id":"local:1","name":"Webcam webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":0,"is_service_running":1,"thumbnail_url":"user_local:1_camera_4_1771348314027.jpg","last_thumbnail_update":"2026-02-17T20:11:54.029Z","created_at":"2026-02-06T21:35:32.055Z","updated_at":"2026-02-18T14:36:19.341Z","store_frames":1,"retention_days":1,"description":"LABEL: other_indoor\\nDESCRIPTION: The environment is dark.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":0,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-18 11:36:19.353036	2026-02-18 14:36:29.97
279	local:1	4	start_camera	{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}	sent	\N	2026-02-18 14:36:19.375	2026-02-18 14:36:29.97
159	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"07:57","schedule_mode":"weekly","schedule_day":{"id":448,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":448,"start_time":"07:57","end_time":"17:00"},"triggered_at_utc":"2026-02-13T10:57:05.032Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":29,"agent_key":"flip flop finder","prompt_template":"procure por pessoas usando chinelos.\\n\\nalert_condition: se avistar alguem de chinelo","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se avistar alguem de chinelo","priority_level":"MEDIUM"},{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.106","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 10:57:05.025	2026-02-13 10:57:09.119
167	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T11:56:56.103Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 11:56:56.103	2026-02-13 11:57:05.977
174	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"09:40","schedule_mode":"weekly","schedule_day":{"id":490,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":490,"start_time":"09:40","end_time":"17:00"},"triggered_at_utc":"2026-02-13T12:40:05.011Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":29,"agent_key":"flip flop finder","prompt_template":"procure por pessoas usando chinelos.\\n\\nalert_condition: se avistar alguem de chinelo","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se avistar alguem de chinelo","priority_level":"MEDIUM"},{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 12:40:05.004	2026-02-13 12:40:10.613
182	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"18:14","schedule_mode":"weekly","schedule_day":{"id":518,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":518,"start_time":"18:14","end_time":"23:00"},"triggered_at_utc":"2026-02-13T21:14:05.073Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 21:14:05.049	2026-02-13 21:14:20.175
192	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"18:55","schedule_mode":"weekly","schedule_day":{"id":553,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":553,"start_time":"18:55","end_time":"23:00"},"triggered_at_utc":"2026-02-13T21:55:05.026Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 21:55:05.018	2026-02-13 21:55:17.716
225	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T12:56:43.953Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 12:56:43.953	2026-02-17 12:56:51.115
160	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T11:04:31.548Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 11:04:31.548	2026-02-13 11:04:40.161
168	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"08:58","schedule_mode":"weekly","schedule_day":{"id":476,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":476,"start_time":"08:58","end_time":"17:00"},"triggered_at_utc":"2026-02-13T11:58:05.052Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":7,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":29,"agent_key":"flip flop finder","prompt_template":"procure por pessoas usando chinelos.\\n\\nalert_condition: se avistar alguem de chinelo","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se avistar alguem de chinelo","priority_level":"MEDIUM"},{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[{"id":5,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHHHHHH","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 11:58:05.04	2026-02-13 11:58:09.65
175	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T12:41:07.584Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 12:41:07.584	2026-02-13 12:41:10.692
183	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T21:16:00.387Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 21:16:00.387	2026-02-13 21:16:05.38
193	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T21:56:37.511Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 21:56:37.511	2026-02-13 21:56:47.91
227	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T13:46:56.606Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 13:46:56.606	2026-02-17 13:46:58.042
261	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T14:04:05.844Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-17 14:04:05.844	2026-02-17 14:04:32.626
280	local:1	4	update_camera	{"id":4,"user_id":"local:1","name":"Webcam webcam","ip_address":"","rtsp_port":null,"manufacturer":"Webcam","username":null,"password":null,"connection_method":"WEBCAM","is_online":1,"is_service_running":0,"thumbnail_url":"user_local:1_camera_4_1771425451464.jpg","last_thumbnail_update":"2026-02-18T17:37:31.468Z","created_at":"2026-02-06T21:35:32.055Z","updated_at":"2026-02-18T14:37:56.558Z","store_frames":1,"retention_days":1,"description":"LABEL: other_indoor\\nDESCRIPTION: The environment is dark.\\n","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":0,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-18 11:37:56.560758	2026-02-18 14:38:00.189
281	local:1	4	stop_camera	{"camera_id":4}	sent	\N	2026-02-18 11:37:56.568185	2026-02-18 14:38:00.189
161	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"08:26","schedule_mode":"weekly","schedule_day":{"id":455,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":455,"start_time":"08:26","end_time":"17:00"},"triggered_at_utc":"2026-02-13T11:26:05.016Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":7,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":29,"agent_key":"flip flop finder","prompt_template":"procure por pessoas usando chinelos.\\n\\nalert_condition: se avistar alguem de chinelo","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se avistar alguem de chinelo","priority_level":"MEDIUM"},{"id":23,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"HIGH"}],"alerts":[{"id":2,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"AHHHH TORCEDOR AVISTADO!","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se algum com camisa de time de futebol for encontrado","pattern":"Webcam webcam","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":8,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":24,"agent_key":"pessoa finder","prompt_template":"pessoa finder\\n\\nalert_condition: se encontrar alguma pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se encontrar alguma pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.106","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 11:26:05.009	2026-02-13 11:26:14.221
169	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T11:59:00.497Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 11:59:00.497	2026-02-13 11:59:09.743
176	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"12:05","schedule_mode":"weekly","schedule_day":{"id":497,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":497,"start_time":"12:05","end_time":"17:00"},"triggered_at_utc":"2026-02-13T15:05:05.016Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 15:05:05.008	2026-02-13 15:05:11.46
184	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"18:28","schedule_mode":"weekly","schedule_day":{"id":525,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":525,"start_time":"18:28","end_time":"23:00"},"triggered_at_utc":"2026-02-13T21:28:05.042Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 21:28:05.018	2026-02-13 21:28:13.406
190	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"18:44","schedule_mode":"weekly","schedule_day":{"id":546,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":546,"start_time":"18:44","end_time":"23:00"},"triggered_at_utc":"2026-02-13T21:44:05.031Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 21:44:05.021	2026-02-13 21:44:16.613
263	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T14:08:35.405Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 14:08:35.405	2026-02-17 14:08:48.304
282	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-18","local_time":"18:40","schedule_mode":"weekly","schedule_day":{"id":773,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":773,"start_time":"18:40","end_time":"23:00"},"triggered_at_utc":"2026-02-18T21:40:05.054Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771342632184-375","name":"grupo 1 teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-18 21:40:05.022	2026-02-18 21:40:16.028
162	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T11:26:32.875Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 11:26:32.875	2026-02-13 11:26:44.296
170	local:1	\N	job_start	{"version":1,"job":{"id":6,"user_id":"local:1","name":"Analise Recepcao SAP_C","description":"recepcao sap CE","status":"scheduled","timezone":"America/Cayenne","schedule_mode":"weekly","active_from":"2026-02-10T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Cayenne","local_date":"2026-02-13","local_time":"09:00","schedule_mode":"weekly","schedule_day":{"id":434,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":434,"start_time":"09:00","end_time":"17:00"},"triggered_at_utc":"2026-02-13T12:00:05.009Z"},"steps":[{"step":{"id":12,"step_order":1,"name":"Passagem RAIO X","timeout_seconds":5000,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":14,"camera_id":8,"camera_name":"SAP_C: Recepcao 2"}],"agents":[{"id":28,"agent_key":"Mochila Raio X","prompt_template":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).\\n\\nDefinições visuais do cenário:\\n\\nPortal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.\\n\\nLinha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco.\\n\\nSentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e lixeira preta pequena).\\n\\n\\nSentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.\\n\\nRegra obrigatória de orientação (anti-falso-positivo):\\n\\nSó gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.\\n\\n“De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.\\n\\nSe a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.\\n\\nO que conta como item carregado:\\n\\nMochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.\\n\\nSe estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.\\n\\nalert_condition: alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).","params":"{}","input_schema":"{}","camera_id":8,"input_type":"video","alert_condition":"alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).","priority_level":"HIGH"}],"alerts":[{"id":4,"condition_expr":"true","channel":"telegram","channel_params":"{}","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps","telegram_chat_id":"@CrimeDetectorCidadao"}]}],"all_camera_ids":[8],"start_camera_payloads":{"8":{"camera_id":8,"name":"SAP_C: Recepcao 2","ip":"10.18.4.96","port":"554","username":"admin","password":"ADMcoint2025","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 12:00:05.005	2026-02-13 12:00:12.841
177	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T15:06:18.735Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 15:06:18.735	2026-02-13 15:06:26.556
185	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T21:28:46.097Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 21:28:46.097	2026-02-13 21:28:58.502
191	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T21:46:35.511Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 21:46:35.511	2026-02-13 21:46:47.108
194	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"18:59","schedule_mode":"weekly","schedule_day":{"id":560,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":560,"start_time":"18:59","end_time":"23:00"},"triggered_at_utc":"2026-02-13T21:59:05.018Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 21:59:05.014	2026-02-13 21:59:08.876
196	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"19:11","schedule_mode":"weekly","schedule_day":{"id":567,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":567,"start_time":"19:11","end_time":"23:00"},"triggered_at_utc":"2026-02-13T22:11:05.022Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 22:11:05.017	2026-02-13 22:11:10.47
265	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T15:36:01.428Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 15:36:01.428	2026-02-17 15:36:14.859
283	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-18T21:40:29.629Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-18 21:40:29.629	2026-02-18 21:40:31.052
163	local:1	3	update_camera	{"id":3,"user_id":"local:1","name":"mibo","ip_address":"192.168.0.107","rtsp_port":"554","manufacturer":"Intelbras","username":"admin","password":"Mibo2025*","connection_method":"RTSP","is_online":0,"is_service_running":0,"thumbnail_url":"user_local:1_camera_3_1770638693945.jpg","last_thumbnail_update":"2026-02-09T15:04:53.947Z","created_at":"2026-02-06T21:33:16.215Z","updated_at":"2026-02-13T11:27:20.459Z","store_frames":1,"retention_days":1,"description":"LABEL: office_room DESCRIPTION: The environment appears to be an interior space with a neutral-toned wall and a window providing an indirect light source.","street":"avenida prefeito dulcidio cardoso","number":"11100","neighborhood":null,"city":"Rio de Janeiro","state":"RJ","zip_code":"22793012","complement":null,"country":"Brazil","timezone":"UTC+0","utc_offset_seconds":0,"webcam_index":null,"allowpublicaccess":0,"analysis_speed":1,"model_tier":"pro"}	sent	\N	2026-02-13 08:27:20.463206	2026-02-13 11:27:29.744
171	local:1	\N	job_stop	{"job":{"id":6,"name":"Analise Recepcao SAP_C"},"requested_at_utc":"2026-02-13T12:01:16.456Z","reason":"user_stop_from_dashboard","camera_ids":[8]}	sent	\N	2026-02-13 12:01:16.456	2026-02-13 12:01:27.983
178	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"12:20","schedule_mode":"weekly","schedule_day":{"id":504,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":504,"start_time":"12:20","end_time":"17:00"},"triggered_at_utc":"2026-02-13T15:20:05.032Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 15:20:05.022	2026-02-13 15:20:13.058
186	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"18:32","schedule_mode":"weekly","schedule_day":{"id":532,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":532,"start_time":"18:32","end_time":"23:00"},"triggered_at_utc":"2026-02-13T21:32:05.035Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 21:32:05.031	2026-02-13 21:32:07.388
195	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T22:00:15.307Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-13 22:00:15.307	2026-02-13 22:00:24.008
197	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T22:13:19.554Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 22:13:19.554	2026-02-13 22:13:25.699
199	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-13T22:58:24.513Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-13 22:58:24.513	2026-02-13 22:58:36.54
267	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T15:38:58.413Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-17 15:38:58.413	2026-02-17 15:39:04.554
285	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-18T22:31:21.933Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-18 22:31:21.933	2026-02-18 22:31:22.517
198	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"19:57","schedule_mode":"weekly","schedule_day":{"id":574,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":574,"start_time":"19:57","end_time":"23:00"},"triggered_at_utc":"2026-02-13T22:57:05.047Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 22:57:05.037	2026-02-13 22:57:06.204
200	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"20:03","schedule_mode":"weekly","schedule_day":{"id":588,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":588,"start_time":"20:03","end_time":"23:00"},"triggered_at_utc":"2026-02-13T23:03:05.015Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 23:03:05.008	2026-02-13 23:03:14.804
269	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T15:58:47.391Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 15:58:47.391	2026-02-17 15:58:49.371
287	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-18T22:34:13.116Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-18 22:34:13.116	2026-02-18 22:34:14.505
202	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"20:06","schedule_mode":"weekly","schedule_day":{"id":595,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":595,"start_time":"20:06","end_time":"23:00"},"triggered_at_utc":"2026-02-13T23:06:05.022Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 23:06:05.017	2026-02-13 23:06:15.379
204	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-13","local_time":"20:17","schedule_mode":"weekly","schedule_day":{"id":602,"day_name":"Friday","day_of_week":5,"day_of_month":null,"month_of_year":null},"window":{"id":602,"start_time":"20:17","end_time":"23:00"},"triggered_at_utc":"2026-02-13T23:17:05.022Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771024091539-262","name":"group_1","targetIds":[20,22],"agentKey":"person finder","inputType":"image"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-13 23:17:05.016	2026-02-13 23:17:07.813
206	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-14","local_time":"12:39","schedule_mode":"weekly","schedule_day":{"id":610,"day_name":"Saturday","day_of_week":6,"day_of_month":null,"month_of_year":null},"window":{"id":610,"start_time":"12:39","end_time":"17:00"},"triggered_at_utc":"2026-02-14T15:39:05.056Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-14 15:39:05.03	2026-02-14 15:39:09.605
271	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T16:40:57.592Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 16:40:57.592	2026-02-17 16:41:10.644
288	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-18","local_time":"19:39","schedule_mode":"weekly","schedule_day":{"id":794,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":794,"start_time":"19:39","end_time":"23:00"},"triggered_at_utc":"2026-02-18T22:39:05.020Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771454268486-499","name":"grupo teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-18 22:39:05.014	2026-02-18 22:39:16.688
208	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-15","local_time":"09:38","schedule_mode":"weekly","schedule_day":{"id":611,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":611,"start_time":"09:38","end_time":"23:00"},"triggered_at_utc":"2026-02-15T12:38:05.033Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-15 12:38:05.013	2026-02-15 12:38:12.608
210	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-15","local_time":"10:03","schedule_mode":"weekly","schedule_day":{"id":618,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":618,"start_time":"10:03","end_time":"23:00"},"triggered_at_utc":"2026-02-15T13:03:05.026Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-15 13:03:05.011	2026-02-15 13:03:18.573
273	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T16:47:14.160Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-17 16:47:14.16	2026-02-17 16:47:15.011
289	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-18T22:40:38.907Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-18 22:40:38.907	2026-02-18 22:40:46.772
212	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-15","local_time":"10:10","schedule_mode":"weekly","schedule_day":{"id":625,"day_name":"Sunday","day_of_week":0,"day_of_month":null,"month_of_year":null},"window":{"id":625,"start_time":"10:10","end_time":"23:00"},"triggered_at_utc":"2026-02-15T13:10:05.055Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771160898255-673","name":"Grupo teste 1","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-15 13:10:05.049	2026-02-15 13:10:09.95
214	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-16","local_time":"12:25","schedule_mode":"weekly","schedule_day":{"id":633,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":633,"start_time":"12:25","end_time":"23:00"},"triggered_at_utc":"2026-02-16T15:25:05.052Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771160898255-673","name":"Grupo teste 1","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-16 15:25:05.03	2026-02-16 15:25:08.416
216	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-16","local_time":"14:18","schedule_mode":"weekly","schedule_day":{"id":640,"day_name":"Monday","day_of_week":1,"day_of_month":null,"month_of_year":null},"window":{"id":640,"start_time":"14:18","end_time":"23:00"},"triggered_at_utc":"2026-02-16T17:18:05.035Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771160898255-673","name":"Grupo teste 1","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-16 17:18:05.028	2026-02-16 17:18:17.807
275	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T16:49:58.194Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 16:49:58.194	2026-02-17 16:50:02.259
290	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-18","local_time":"19:44","schedule_mode":"weekly","schedule_day":{"id":801,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":801,"start_time":"19:44","end_time":"23:00"},"triggered_at_utc":"2026-02-18T22:44:05.031Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771454268486-499","name":"grupo teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":22,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-18 22:44:05.013	2026-02-18 22:44:18.166
218	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"09:43","schedule_mode":"weekly","schedule_day":{"id":648,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":648,"start_time":"09:43","end_time":"17:00"},"triggered_at_utc":"2026-02-17T12:43:05.027Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771160898255-673","name":"Grupo teste 1","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":22,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 12:43:05.005	2026-02-17 12:43:12.248
220	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"09:48","schedule_mode":"weekly","schedule_day":{"id":655,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":655,"start_time":"09:48","end_time":"17:00"},"triggered_at_utc":"2026-02-17T12:48:05.017Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 12:48:05.011	2026-02-17 12:48:13.682
277	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-17T17:12:03.614Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-17 17:12:03.614	2026-02-17 17:12:05.435
291	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-18T22:44:26.039Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-18 22:44:26.039	2026-02-18 22:44:33.179
222	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"09:51","schedule_mode":"weekly","schedule_day":{"id":662,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":662,"start_time":"09:51","end_time":"17:00"},"triggered_at_utc":"2026-02-17T12:51:05.033Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 12:51:05.026	2026-02-17 12:51:15.358
224	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"09:56","schedule_mode":"weekly","schedule_day":{"id":669,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":669,"start_time":"09:56","end_time":"17:00"},"triggered_at_utc":"2026-02-17T12:56:05.049Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 12:56:05.037	2026-02-17 12:56:06.061
292	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-18","local_time":"20:06","schedule_mode":"weekly","schedule_day":{"id":808,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":808,"start_time":"20:06","end_time":"23:00"},"triggered_at_utc":"2026-02-18T23:06:05.062Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771454268486-499","name":"grupo teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":22,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-18 23:06:05.055	2026-02-18 23:06:07.585
226	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"10:44","schedule_mode":"weekly","schedule_day":{"id":676,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":676,"start_time":"10:44","end_time":"17:00"},"triggered_at_utc":"2026-02-17T13:44:05.031Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 13:44:05.018	2026-02-17 13:44:12.626
228	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"11:01","schedule_mode":"weekly","schedule_day":{"id":683,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":683,"start_time":"11:01","end_time":"17:00"},"triggered_at_utc":"2026-02-17T14:01:05.017Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 14:01:05.009	2026-02-17 14:01:17.275
293	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-18T23:07:22.244Z","reason":"user_stop_from_dashboard","camera_ids":[3,4]}	sent	\N	2026-02-18 23:07:22.244	2026-02-18 23:07:22.867
262	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"11:06","schedule_mode":"weekly","schedule_day":{"id":716,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":716,"start_time":"11:06","end_time":"17:00"},"triggered_at_utc":"2026-02-17T14:06:05.037Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":22,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 14:06:05.009	2026-02-17 14:06:17.916
264	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"12:35","schedule_mode":"weekly","schedule_day":{"id":723,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":723,"start_time":"12:35","end_time":"17:00"},"triggered_at_utc":"2026-02-17T15:35:05.034Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":22,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 15:35:05.015	2026-02-17 15:35:14.784
266	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"12:38","schedule_mode":"weekly","schedule_day":{"id":730,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":730,"start_time":"12:38","end_time":"17:00"},"triggered_at_utc":"2026-02-17T15:38:05.039Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771342632184-375","name":"grupo 1 teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 15:38:05.033	2026-02-17 15:38:19.472
294	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-18","local_time":"20:11","schedule_mode":"weekly","schedule_day":{"id":815,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":815,"start_time":"20:11","end_time":"23:00"},"triggered_at_utc":"2026-02-18T23:11:05.046Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771454268486-499","name":"grupo teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":22,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-18 23:11:05.04	2026-02-18 23:11:09.513
268	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"12:58","schedule_mode":"weekly","schedule_day":{"id":737,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":737,"start_time":"12:58","end_time":"17:00"},"triggered_at_utc":"2026-02-17T15:58:05.022Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771342632184-375","name":"grupo 1 teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 15:58:05.015	2026-02-17 15:58:19.331
270	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"13:40","schedule_mode":"weekly","schedule_day":{"id":744,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":744,"start_time":"13:40","end_time":"17:00"},"triggered_at_utc":"2026-02-17T16:40:05.039Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771342632184-375","name":"grupo 1 teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":22,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 16:40:05.035	2026-02-17 16:40:10.444
272	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"13:46","schedule_mode":"weekly","schedule_day":{"id":751,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":751,"start_time":"13:46","end_time":"17:00"},"triggered_at_utc":"2026-02-17T16:46:05.014Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771342632184-375","name":"grupo 1 teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 16:46:05.003	2026-02-17 16:46:14.932
295	local:1	\N	job_stop	{"job":{"id":4,"name":"JOB TESTE"},"requested_at_utc":"2026-02-18T23:11:47.575Z","reason":"user_stop_from_dashboard","camera_ids":[4,3]}	sent	\N	2026-02-18 23:11:47.575	2026-02-18 23:11:54.592
274	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"13:49","schedule_mode":"weekly","schedule_day":{"id":758,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":758,"start_time":"13:49","end_time":"17:00"},"triggered_at_utc":"2026-02-17T16:49:05.029Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771342632184-375","name":"grupo 1 teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 16:49:05.018	2026-02-17 16:49:17.193
276	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-17","local_time":"14:11","schedule_mode":"weekly","schedule_day":{"id":765,"day_name":"Tuesday","day_of_week":2,"day_of_month":null,"month_of_year":null},"window":{"id":765,"start_time":"14:11","end_time":"17:00"},"triggered_at_utc":"2026-02-17T17:11:05.057Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771342632184-375","name":"grupo 1 teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-17 17:11:05.05	2026-02-17 17:11:05.355
284	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-18","local_time":"19:28","schedule_mode":"weekly","schedule_day":{"id":780,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":780,"start_time":"19:28","end_time":"23:00"},"triggered_at_utc":"2026-02-18T22:28:05.020Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-18 22:28:05.014	2026-02-18 22:28:07.25
296	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-18","local_time":"20:14","schedule_mode":"weekly","schedule_day":{"id":822,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":822,"start_time":"20:14","end_time":"23:00"},"triggered_at_utc":"2026-02-18T23:14:05.049Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[{"id":"group-1771454268486-499","name":"grupo teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":22,"camera_id":4,"camera_name":"Webcam webcam"},{"id":20,"camera_id":3,"camera_name":"mibo"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"video","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"}],"alerts":[]}],"all_camera_ids":[4,3,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-18 23:14:05.034	2026-02-18 23:14:11.754
286	local:1	\N	job_start	{"version":1,"job":{"id":4,"user_id":"local:1","name":"JOB TESTE","description":"job para testar funcionalidades","status":"scheduled","timezone":"America/Sao_Paulo","schedule_mode":"weekly","active_from":"2026-02-08T03:00:00.000Z","active_until":null},"trigger":{"trigger_type":"schedule","timezone":"America/Sao_Paulo","local_date":"2026-02-18","local_time":"19:33","schedule_mode":"weekly","schedule_day":{"id":787,"day_name":"Wednesday","day_of_week":3,"day_of_month":null,"month_of_year":null},"window":{"id":787,"start_time":"19:33","end_time":"23:00"},"triggered_at_utc":"2026-02-18T22:33:05.050Z"},"steps":[{"step":{"id":6,"step_order":1,"name":"step teste 1 ","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"time","from_step_id":null,"camera_id":null,"extract":null,"pattern":null,"time_offset_sec":0},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":20,"camera_id":3,"camera_name":"mibo"},{"id":22,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":31,"agent_key":"woman finder","prompt_template":"ache alguma mulher de cabelo preto\\n\\nalert_condition: se achar alguma mulher de cabelo preto","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar alguma mulher de cabelo preto","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"},{"id":29,"agent_key":"person finder","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","params":"{}","input_schema":"{}","camera_id":3,"input_type":"image","alert_condition":"se achar qualquer pessoa","priority_level":"CRITIC","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":7,"step_order":2,"name":"step teste 2","timeout_seconds":120,"on_missing_input":"skip","start_condition":{"mode":"custom","from_step_id":6,"camera_id":null,"extract":"se uma pessoa for vista","pattern":"mibo","time_offset_sec":null},"pipeline":{"input_from_step_id":6,"input_inject_key":"Webcam webcam","camera_id":4},"inference_groups":[],"pipelines":[{"input_from_step_id":6,"target_camera_id":3,"inputs":[{"input_inject_key":"Webcam webcam","camera_id":4}]}]},"targets":[{"id":21,"camera_id":4,"camera_name":"Webcam webcam"}],"agents":[{"id":30,"agent_key":"black shirt finder","prompt_template":"ache pessoas com blusas pretas\\n\\nalert_condition: se achar uma pessoa com blusa preta","params":"{}","input_schema":"{}","camera_id":4,"input_type":"video","alert_condition":"se achar uma pessoa com blusa preta","priority_level":"HIGH","inference_model":"pro","api_key":"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"}],"alerts":[]},{"step":{"id":8,"step_order":3,"name":"step teste 3","timeout_seconds":600,"on_missing_input":"skip","start_condition":{"mode":"sequential","from_step_id":7,"camera_id":null,"extract":"result","pattern":null,"time_offset_sec":null},"pipeline":null,"inference_groups":[],"input_from_step_id":null,"input_inject_key":null},"targets":[{"id":9,"camera_id":2,"camera_name":"hikvision escritorio"}],"agents":[{"id":14,"agent_key":"dog finder","prompt_template":"procure cachorros na imagem\\n\\nalert_condition: se encontrar cachorro","params":"{}","input_schema":"{}","camera_id":2,"input_type":"video","alert_condition":"se encontrar cachorro","priority_level":"MEDIUM","inference_model":"pro","api_key":"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"}],"alerts":[]}],"all_camera_ids":[3,4,2],"start_camera_payloads":{"2":{"camera_id":2,"name":"hikvision escritorio","ip":"192.168.1.64","port":null,"username":"admin","password":"Nick2007","manufacturer":"Hikvision","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"3":{"camera_id":3,"name":"mibo","ip":"192.168.0.107","port":"554","username":"admin","password":"Mibo2025*","manufacturer":"Intelbras","connection_method":"RTSP","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":null,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"},"4":{"camera_id":4,"name":"Webcam webcam","ip":"","port":null,"username":null,"password":null,"manufacturer":"Webcam","connection_method":"WEBCAM","enabled_algorithms":[],"store_frames":true,"retention_days":1,"frame_rate":12,"webcam_index":0,"timezone":"UTC+0","utc_offset_seconds":0,"analysis_speed":1,"model_tier":"pro","telegram_enabled":true,"telegram_chat_id":"@CrimeDetectorCidadao","telegram_bot_token":"7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps"}}}	sent	\N	2026-02-18 22:33:05.034	2026-02-18 22:33:14.392
\.


--
-- TOC entry 5409 (class 0 OID 42866)
-- Dependencies: 232
-- Data for Name: cron_locks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cron_locks (name, locked_until_utc, created_at, updated_at) FROM stdin;
job_scheduler	2026-02-18T23:53:00.011Z	2026-02-06 13:39:05.03	2026-02-18 23:52:05.011
\.


--
-- TOC entry 5410 (class 0 OID 42873)
-- Dependencies: 233
-- Data for Name: detections; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.detections (id, user_id, camera_id, camera_name, algo_type, detected_at, image_key, event_id, created_at, video_key, media_type) FROM stdin;
\.


--
-- TOC entry 5412 (class 0 OID 42881)
-- Dependencies: 235
-- Data for Name: events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.events (id, user_id, camera_id, event_type, description, metadata, created_at, updated_at, message, details_json, is_unread) FROM stdin;
1	demo-user	1	camera_offline	A câmera parou de responder	\N	2025-12-07 11:46:40.217079	2025-12-07 11:46:40.217079	Timeout ao conectar	{"error":"timeout"}	1
2	local:1	2	camera_connection_failed	\N	\N	2026-02-05 21:40:12.58	2026-02-05 18:40:57.323903	Failed to connect to camera.	{"error":"avformat_open_input: Immediate exit requested","rtsp_url":"rtsp://admin:Nick2007@192.168.1.64:554/Streaming/Channels/101"}	0
3	local:1	2	thumbnail_updated	\N	\N	2026-02-05 21:42:27.206	2026-02-05 21:42:27.206	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770327747201.jpg","timestamp":"2026-02-05T21:42:27.206Z"}	0
4	local:1	2	thumbnail_updated	\N	\N	2026-02-05 21:43:27.197	2026-02-05 21:43:27.197	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770327807194.jpg","timestamp":"2026-02-05T21:43:27.197Z"}	0
5	local:1	2	thumbnail_updated	\N	\N	2026-02-05 21:44:27.244	2026-02-05 21:44:27.244	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770327867243.jpg","timestamp":"2026-02-05T21:44:27.244Z"}	0
6	local:1	2	thumbnail_updated	\N	\N	2026-02-06 13:33:02.842	2026-02-06 13:33:02.842	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770384782839.jpg","timestamp":"2026-02-06T13:33:02.842Z"}	0
7	local:1	2	thumbnail_updated	\N	\N	2026-02-06 13:38:46.098	2026-02-06 13:38:46.098	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770385126097.jpg","timestamp":"2026-02-06T13:38:46.098Z"}	0
8	local:1	2	thumbnail_updated	\N	\N	2026-02-06 13:39:46.106	2026-02-06 13:39:46.106	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770385186105.jpg","timestamp":"2026-02-06T13:39:46.106Z"}	0
9	local:1	2	thumbnail_updated	\N	\N	2026-02-06 21:30:49.021	2026-02-06 21:30:49.021	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770413449020.jpg","timestamp":"2026-02-06T21:30:49.021Z"}	0
10	local:1	2	thumbnail_updated	\N	\N	2026-02-06 21:31:49.058	2026-02-06 21:31:49.058	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770413509055.jpg","timestamp":"2026-02-06T21:31:49.058Z"}	0
11	local:1	2	thumbnail_updated	\N	\N	2026-02-06 21:32:49.12	2026-02-06 21:32:49.12	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770413569114.jpg","timestamp":"2026-02-06T21:32:49.120Z"}	0
12	local:1	2	thumbnail_updated	\N	\N	2026-02-06 21:33:49.169	2026-02-06 21:33:49.169	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770413629164.jpg","timestamp":"2026-02-06T21:33:49.169Z"}	0
13	local:1	3	thumbnail_updated	\N	\N	2026-02-06 21:34:04.386	2026-02-06 21:34:04.386	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770413644383.jpg","timestamp":"2026-02-06T21:34:04.386Z"}	0
14	local:1	2	thumbnail_updated	\N	\N	2026-02-06 21:34:49.204	2026-02-06 21:34:49.204	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770413689200.jpg","timestamp":"2026-02-06T21:34:49.204Z"}	0
15	local:1	3	thumbnail_updated	\N	\N	2026-02-06 21:35:04.395	2026-02-06 21:35:04.395	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770413704390.jpg","timestamp":"2026-02-06T21:35:04.395Z"}	0
16	local:1	4	thumbnail_updated	\N	\N	2026-02-06 21:35:47.405	2026-02-06 21:35:47.405	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770413747402.jpg","timestamp":"2026-02-06T21:35:47.405Z"}	0
17	local:1	2	thumbnail_updated	\N	\N	2026-02-06 21:35:49.237	2026-02-06 21:35:49.237	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770413749234.jpg","timestamp":"2026-02-06T21:35:49.237Z"}	0
18	local:1	3	thumbnail_updated	\N	\N	2026-02-06 21:36:04.382	2026-02-06 21:36:04.382	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770413764378.jpg","timestamp":"2026-02-06T21:36:04.382Z"}	0
19	local:1	4	thumbnail_updated	\N	\N	2026-02-06 21:36:47.428	2026-02-06 21:36:47.428	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770413807423.jpg","timestamp":"2026-02-06T21:36:47.428Z"}	0
20	local:1	2	thumbnail_updated	\N	\N	2026-02-06 21:36:49.836	2026-02-06 21:36:49.836	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770413809830.jpg","timestamp":"2026-02-06T21:36:49.836Z"}	0
21	local:1	3	thumbnail_updated	\N	\N	2026-02-06 21:37:04.423	2026-02-06 21:37:04.423	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770413824420.jpg","timestamp":"2026-02-06T21:37:04.423Z"}	0
22	local:1	\N	job_started	\N	\N	2026-02-06 22:55:11.086	2026-02-06 22:55:11.086		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-06","local_time":"19:55","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":35,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-06T22:55:05.009Z","window":{"end_time":"23:00","id":35,"start_time":"19:55"}}}	1
23	local:1	\N	job_step_started	\N	\N	2026-02-06 22:55:11.138	2026-02-06 22:55:11.138		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
24	local:1	\N	job_step_started	\N	\N	2026-02-06 22:55:13.112	2026-02-06 22:55:13.112		{"job_id":3,"job_name":"Contagem","step_id":3,"step_name":"Contagem pessoas volta","step_order":2,"targets":2,"timeout_seconds":300}	1
25	local:1	4	thumbnail_updated	\N	\N	2026-02-06 22:55:14.713	2026-02-06 22:55:14.713	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770418514709.jpg","timestamp":"2026-02-06T22:55:14.713Z"}	0
26	local:1	2	thumbnail_updated	\N	\N	2026-02-06 22:55:15.312	2026-02-06 22:55:15.312	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770418515310.jpg","timestamp":"2026-02-06T22:55:15.312Z"}	0
27	local:1	3	thumbnail_updated	\N	\N	2026-02-06 22:55:17.379	2026-02-06 22:55:17.379	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770418517377.jpg","timestamp":"2026-02-06T22:55:17.379Z"}	0
28	local:1	\N	job_stop_requested	\N	\N	2026-02-06 22:55:47.448	2026-02-06 22:55:47.448	Job "Contagem" stop requested.	\N	0
29	local:1	\N	job_stopped	\N	\N	2026-02-06 22:55:56.156	2026-02-06 22:55:56.156	Job "Contagem" stopped (acknowledged by EXE).	\N	0
30	local:1	\N	job_step_completed	\N	\N	2026-02-06 22:55:56.306	2026-02-06 22:55:56.306		{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
31	local:1	\N	job_step_completed	\N	\N	2026-02-06 22:55:56.311	2026-02-06 22:55:56.311		{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":3,"step_name":"Contagem pessoas volta","step_order":2}	1
32	local:1	\N	job_stopped	\N	\N	2026-02-06 22:55:56.326	2026-02-06 22:55:56.326		{"job_id":3,"reason":"cancelled"}	1
33	local:1	\N	job_started	\N	\N	2026-02-07 12:00:18.595	2026-02-07 12:00:18.595		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-07","local_time":"09:00","schedule_day":{"day_name":"Saturday","day_of_month":null,"day_of_week":6,"id":36,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-07T12:00:05.045Z","window":{"end_time":"17:00","id":36,"start_time":"09:00"}}}	1
34	local:1	\N	job_step_started	\N	\N	2026-02-07 12:00:18.618	2026-02-07 12:00:18.618		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
326	local:1	\N	job_stopped	\N	\N	2026-02-08 14:30:11.881	2026-02-08 14:30:11.881		{"job_id":4,"reason":"cancelled"}	1
35	local:1	2	thumbnail_updated	\N	\N	2026-02-07 12:00:22.684	2026-02-07 12:00:22.684	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770465622681.jpg","timestamp":"2026-02-07T12:00:22.684Z"}	0
36	local:1	3	thumbnail_updated	\N	\N	2026-02-07 12:00:22.71	2026-02-07 12:00:22.71	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770465622708.jpg","timestamp":"2026-02-07T12:00:22.710Z"}	0
37	local:1	2	thumbnail_updated	\N	\N	2026-02-07 12:03:58.267	2026-02-07 12:03:58.267	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770465838262.jpg","timestamp":"2026-02-07T12:03:58.267Z"}	0
38	local:1	3	thumbnail_updated	\N	\N	2026-02-07 12:04:19.349	2026-02-07 12:04:19.349	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770465859345.jpg","timestamp":"2026-02-07T12:04:19.349Z"}	0
39	local:1	2	thumbnail_updated	\N	\N	2026-02-07 12:04:58.28	2026-02-07 12:04:58.28	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770465898277.jpg","timestamp":"2026-02-07T12:04:58.280Z"}	0
40	local:1	3	thumbnail_updated	\N	\N	2026-02-07 12:05:19.359	2026-02-07 12:05:19.359	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770465919357.jpg","timestamp":"2026-02-07T12:05:19.359Z"}	0
41	local:1	\N	job_step_completed	\N	\N	2026-02-07 12:05:19.582	2026-02-07 12:05:19.582		{"job_id":3,"job_name":"Contagem","reason":"timeout","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
42	local:1	\N	job_step_started	\N	\N	2026-02-07 12:05:19.847	2026-02-07 12:05:19.847		{"job_id":3,"job_name":"Contagem","step_id":3,"step_name":"Contagem pessoas volta","step_order":2,"targets":2,"timeout_seconds":300}	1
43	local:1	4	thumbnail_updated	\N	\N	2026-02-07 12:05:21.335	2026-02-07 12:05:21.335	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770465921333.jpg","timestamp":"2026-02-07T12:05:21.335Z"}	0
44	local:1	3	thumbnail_updated	\N	\N	2026-02-07 12:05:24.206	2026-02-07 12:05:24.206	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770465924202.jpg","timestamp":"2026-02-07T12:05:24.206Z"}	0
45	local:1	2	thumbnail_updated	\N	\N	2026-02-07 12:05:58.32	2026-02-07 12:05:58.32	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770465958316.jpg","timestamp":"2026-02-07T12:05:58.320Z"}	0
46	local:1	4	thumbnail_updated	\N	\N	2026-02-07 12:06:21.363	2026-02-07 12:06:21.363	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770465981359.jpg","timestamp":"2026-02-07T12:06:21.363Z"}	0
47	local:1	3	thumbnail_updated	\N	\N	2026-02-07 12:06:24.215	2026-02-07 12:06:24.215	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770465984212.jpg","timestamp":"2026-02-07T12:06:24.215Z"}	0
48	local:1	2	thumbnail_updated	\N	\N	2026-02-07 12:06:58.346	2026-02-07 12:06:58.346	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770466018342.jpg","timestamp":"2026-02-07T12:06:58.346Z"}	0
49	local:1	4	thumbnail_updated	\N	\N	2026-02-07 12:07:21.392	2026-02-07 12:07:21.392	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770466041390.jpg","timestamp":"2026-02-07T12:07:21.392Z"}	0
50	local:1	3	thumbnail_updated	\N	\N	2026-02-07 12:07:24.213	2026-02-07 12:07:24.213	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770466044210.jpg","timestamp":"2026-02-07T12:07:24.213Z"}	0
51	local:1	2	thumbnail_updated	\N	\N	2026-02-07 12:07:58.385	2026-02-07 12:07:58.385	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770466078379.jpg","timestamp":"2026-02-07T12:07:58.385Z"}	0
52	local:1	4	thumbnail_updated	\N	\N	2026-02-07 12:08:21.422	2026-02-07 12:08:21.422	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770466101420.jpg","timestamp":"2026-02-07T12:08:21.422Z"}	0
53	local:1	3	thumbnail_updated	\N	\N	2026-02-07 12:08:24.289	2026-02-07 12:08:24.289	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770466104287.jpg","timestamp":"2026-02-07T12:08:24.289Z"}	0
54	local:1	\N	job_stop_requested	\N	\N	2026-02-07 12:08:40.007	2026-02-07 12:08:40.007	Job "Contagem" stop requested.	\N	0
55	local:1	\N	job_stopped	\N	\N	2026-02-07 12:08:50.089	2026-02-07 12:08:50.089	Job "Contagem" stopped (acknowledged by EXE).	\N	0
56	local:1	\N	job_step_completed	\N	\N	2026-02-07 12:08:51.076	2026-02-07 12:08:51.076		{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":3,"step_name":"Contagem pessoas volta","step_order":2}	1
57	local:1	\N	job_stopped	\N	\N	2026-02-07 12:08:51.093	2026-02-07 12:08:51.093		{"job_id":3,"reason":"cancelled"}	1
58	local:1	\N	job_started	\N	\N	2026-02-07 13:59:10.146	2026-02-07 13:59:10.146		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-07","local_time":"10:59","schedule_day":{"day_name":"Saturday","day_of_month":null,"day_of_week":6,"id":43,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-07T13:59:05.010Z","window":{"end_time":"23:00","id":43,"start_time":"10:59"}}}	1
59	local:1	\N	job_step_started	\N	\N	2026-02-07 13:59:10.179	2026-02-07 13:59:10.179		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
60	local:1	2	thumbnail_updated	\N	\N	2026-02-07 13:59:14.381	2026-02-07 13:59:14.381	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770472754378.jpg","timestamp":"2026-02-07T13:59:14.381Z"}	0
61	local:1	3	thumbnail_updated	\N	\N	2026-02-07 13:59:14.401	2026-02-07 13:59:14.401	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770472754399.jpg","timestamp":"2026-02-07T13:59:14.401Z"}	0
62	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:00:14.455	2026-02-07 14:00:14.455	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770472814450.jpg","timestamp":"2026-02-07T14:00:14.455Z"}	0
63	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:00:31.083	2026-02-07 14:00:31.083	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770472831081.jpg","timestamp":"2026-02-07T14:00:31.083Z"}	0
64	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:01:14.497	2026-02-07 14:01:14.497	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770472874492.jpg","timestamp":"2026-02-07T14:01:14.497Z"}	0
65	local:1	\N	job_step_completed	\N	\N	2026-02-07 14:04:10.977	2026-02-07 14:04:10.977		{"job_id":3,"job_name":"Contagem","reason":"timeout","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
66	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:06:23.956	2026-02-07 14:06:23.956	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473183950.jpg","timestamp":"2026-02-07T14:06:23.956Z"}	0
67	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:06:50.602	2026-02-07 14:06:50.602	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473210597.jpg","timestamp":"2026-02-07T14:06:50.602Z"}	0
68	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:07:38.956	2026-02-07 14:07:38.956	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473258950.jpg","timestamp":"2026-02-07T14:07:38.956Z"}	0
69	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:07:50.653	2026-02-07 14:07:50.653	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473270649.jpg","timestamp":"2026-02-07T14:07:50.653Z"}	0
70	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:08:38.982	2026-02-07 14:08:38.982	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473318979.jpg","timestamp":"2026-02-07T14:08:38.982Z"}	0
71	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:08:50.67	2026-02-07 14:08:50.67	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473330665.jpg","timestamp":"2026-02-07T14:08:50.670Z"}	0
72	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:09:39.011	2026-02-07 14:09:39.011	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473379009.jpg","timestamp":"2026-02-07T14:09:39.011Z"}	0
73	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:09:50.701	2026-02-07 14:09:50.701	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473390695.jpg","timestamp":"2026-02-07T14:09:50.701Z"}	0
74	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:10:39.019	2026-02-07 14:10:39.019	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473439012.jpg","timestamp":"2026-02-07T14:10:39.019Z"}	0
75	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:10:50.717	2026-02-07 14:10:50.717	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473450715.jpg","timestamp":"2026-02-07T14:10:50.717Z"}	0
76	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:11:38.986	2026-02-07 14:11:38.986	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473498984.jpg","timestamp":"2026-02-07T14:11:38.986Z"}	0
77	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:11:50.784	2026-02-07 14:11:50.784	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473510782.jpg","timestamp":"2026-02-07T14:11:50.784Z"}	0
78	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:12:39.051	2026-02-07 14:12:39.051	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473559049.jpg","timestamp":"2026-02-07T14:12:39.051Z"}	0
79	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:12:50.822	2026-02-07 14:12:50.822	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473570821.jpg","timestamp":"2026-02-07T14:12:50.822Z"}	0
80	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:13:39.114	2026-02-07 14:13:39.114	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473619113.jpg","timestamp":"2026-02-07T14:13:39.114Z"}	0
81	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:13:50.874	2026-02-07 14:13:50.874	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473630872.jpg","timestamp":"2026-02-07T14:13:50.874Z"}	0
82	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:14:39.153	2026-02-07 14:14:39.153	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473679152.jpg","timestamp":"2026-02-07T14:14:39.153Z"}	0
83	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:14:50.919	2026-02-07 14:14:50.919	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473690917.jpg","timestamp":"2026-02-07T14:14:50.919Z"}	0
84	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:15:39.164	2026-02-07 14:15:39.164	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473739163.jpg","timestamp":"2026-02-07T14:15:39.164Z"}	0
85	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:16:02.152	2026-02-07 14:16:02.152	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770473762150.jpg","timestamp":"2026-02-07T14:16:02.152Z"}	0
86	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:16:46.535	2026-02-07 14:16:46.535	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473806532.jpg","timestamp":"2026-02-07T14:16:46.535Z"}	0
87	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:17:46.56	2026-02-07 14:17:46.56	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770473866557.jpg","timestamp":"2026-02-07T14:17:46.560Z"}	0
88	local:1	\N	job_stop_requested	\N	\N	2026-02-07 14:17:51.072	2026-02-07 14:17:51.072	Job "Contagem" stop requested.	\N	0
89	local:1	\N	job_stopped	\N	\N	2026-02-07 14:18:02.335	2026-02-07 14:18:02.335	Job "Contagem" stopped (acknowledged by EXE).	\N	0
90	local:1	\N	job_stopped	\N	\N	2026-02-07 14:18:02.555	2026-02-07 14:18:02.555		{"job_id":3,"reason":"cancelled"}	1
91	local:1	\N	job_started	\N	\N	2026-02-07 14:20:18.099	2026-02-07 14:20:18.099		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-07","local_time":"11:20","schedule_day":{"day_name":"Saturday","day_of_month":null,"day_of_week":6,"id":57,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-07T14:20:05.044Z","window":{"end_time":"23:00","id":57,"start_time":"11:20"}}}	1
92	local:1	\N	job_step_started	\N	\N	2026-02-07 14:20:18.131	2026-02-07 14:20:18.131		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
93	local:1	\N	job_step_started	\N	\N	2026-02-07 14:20:20.571	2026-02-07 14:20:20.571		{"job_id":3,"job_name":"Contagem","step_id":3,"step_name":"Contagem pessoas volta","step_order":2,"targets":2,"timeout_seconds":300}	1
94	local:1	4	thumbnail_updated	\N	\N	2026-02-07 14:20:22.055	2026-02-07 14:20:22.055	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770474022054.jpg","timestamp":"2026-02-07T14:20:22.055Z"}	0
95	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:20:22.473	2026-02-07 14:20:22.473	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770474022472.jpg","timestamp":"2026-02-07T14:20:22.473Z"}	0
96	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:20:25.042	2026-02-07 14:20:25.042	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770474025040.jpg","timestamp":"2026-02-07T14:20:25.042Z"}	0
97	local:1	\N	job_stop_requested	\N	\N	2026-02-07 14:21:19.518	2026-02-07 14:21:19.518	Job "Contagem" stop requested.	\N	0
98	local:1	4	thumbnail_updated	\N	\N	2026-02-07 14:21:22.107	2026-02-07 14:21:22.107	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770474082103.jpg","timestamp":"2026-02-07T14:21:22.107Z"}	0
99	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:21:22.49	2026-02-07 14:21:22.49	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770474082485.jpg","timestamp":"2026-02-07T14:21:22.490Z"}	0
100	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:21:25.051	2026-02-07 14:21:25.051	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770474085047.jpg","timestamp":"2026-02-07T14:21:25.051Z"}	0
101	local:1	\N	job_stopped	\N	\N	2026-02-07 14:21:33.312	2026-02-07 14:21:33.312	Job "Contagem" stopped (acknowledged by EXE).	\N	0
102	local:1	\N	job_step_completed	\N	\N	2026-02-07 14:21:34.293	2026-02-07 14:21:34.293		{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
103	local:1	\N	job_step_completed	\N	\N	2026-02-07 14:21:34.309	2026-02-07 14:21:34.309		{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":3,"step_name":"Contagem pessoas volta","step_order":2}	1
104	local:1	\N	job_stopped	\N	\N	2026-02-07 14:21:34.323	2026-02-07 14:21:34.323		{"job_id":3,"reason":"cancelled"}	1
105	local:1	\N	job_started	\N	\N	2026-02-07 14:40:08.165	2026-02-07 14:40:08.165		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-07","local_time":"11:40","schedule_day":{"day_name":"Saturday","day_of_month":null,"day_of_week":6,"id":64,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-07T14:40:05.060Z","window":{"end_time":"23:00","id":64,"start_time":"11:40"}}}	1
106	local:1	\N	job_step_started	\N	\N	2026-02-07 14:40:08.24	2026-02-07 14:40:08.24		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
107	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:40:12.377	2026-02-07 14:40:12.377	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770475212374.jpg","timestamp":"2026-02-07T14:40:12.377Z"}	0
108	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:40:12.385	2026-02-07 14:40:12.385	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770475212383.jpg","timestamp":"2026-02-07T14:40:12.385Z"}	0
109	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:41:12.428	2026-02-07 14:41:12.428	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770475272421.jpg","timestamp":"2026-02-07T14:41:12.428Z"}	0
110	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:41:12.461	2026-02-07 14:41:12.461	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770475272456.jpg","timestamp":"2026-02-07T14:41:12.461Z"}	0
111	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:42:12.486	2026-02-07 14:42:12.486	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770475332482.jpg","timestamp":"2026-02-07T14:42:12.486Z"}	0
112	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:42:12.739	2026-02-07 14:42:12.739	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770475332736.jpg","timestamp":"2026-02-07T14:42:12.739Z"}	0
113	local:1	2	thumbnail_updated	\N	\N	2026-02-07 14:43:12.469	2026-02-07 14:43:12.469	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770475392465.jpg","timestamp":"2026-02-07T14:43:12.469Z"}	0
114	local:1	3	thumbnail_updated	\N	\N	2026-02-07 14:43:12.789	2026-02-07 14:43:12.789	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770475392786.jpg","timestamp":"2026-02-07T14:43:12.789Z"}	0
115	local:1	\N	job_stop_requested	\N	\N	2026-02-07 14:43:42.399	2026-02-07 14:43:42.399	Job "Contagem" stop requested.	\N	0
116	local:1	\N	job_stopped	\N	\N	2026-02-07 14:43:53.758	2026-02-07 14:43:53.758	Job "Contagem" stopped (acknowledged by EXE).	\N	0
117	local:1	\N	job_step_completed	\N	\N	2026-02-07 14:43:53.977	2026-02-07 14:43:53.977		{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
118	local:1	\N	job_stopped	\N	\N	2026-02-07 14:43:53.983	2026-02-07 14:43:53.983		{"job_id":3,"reason":"cancelled"}	1
119	local:1	\N	job_started	\N	\N	2026-02-07 20:11:14.786	2026-02-07 20:11:14.786		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-07","local_time":"17:11","schedule_day":{"day_name":"Saturday","day_of_month":null,"day_of_week":6,"id":71,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-07T20:11:05.030Z","window":{"end_time":"23:00","id":71,"start_time":"17:11"}}}	1
120	local:1	\N	job_step_started	\N	\N	2026-02-07 20:11:14.818	2026-02-07 20:11:14.818		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
121	local:1	\N	job_step_started	\N	\N	2026-02-07 20:11:14.834	2026-02-07 20:11:14.834		{"job_id":3,"job_name":"Contagem","step_id":5,"step_name":"teste final 2","step_order":4,"targets":0,"timeout_seconds":300}	1
122	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:11:19.023	2026-02-07 20:11:19.023	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495079021.jpg","timestamp":"2026-02-07T20:11:19.023Z"}	0
123	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:11:19.519	2026-02-07 20:11:19.519	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495079517.jpg","timestamp":"2026-02-07T20:11:19.519Z"}	0
124	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:12:19.069	2026-02-07 20:12:19.069	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495139067.jpg","timestamp":"2026-02-07T20:12:19.069Z"}	0
125	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:12:19.596	2026-02-07 20:12:19.596	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495139594.jpg","timestamp":"2026-02-07T20:12:19.596Z"}	0
126	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:13:19.066	2026-02-07 20:13:19.066	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495199064.jpg","timestamp":"2026-02-07T20:13:19.066Z"}	0
127	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:13:19.601	2026-02-07 20:13:19.601	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495199599.jpg","timestamp":"2026-02-07T20:13:19.601Z"}	0
128	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:14:19.112	2026-02-07 20:14:19.112	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495259111.jpg","timestamp":"2026-02-07T20:14:19.112Z"}	0
129	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:14:19.672	2026-02-07 20:14:19.672	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495259669.jpg","timestamp":"2026-02-07T20:14:19.672Z"}	0
130	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:15:19.162	2026-02-07 20:15:19.162	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495319158.jpg","timestamp":"2026-02-07T20:15:19.162Z"}	0
131	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:15:19.69	2026-02-07 20:15:19.69	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495319687.jpg","timestamp":"2026-02-07T20:15:19.690Z"}	0
132	local:1	\N	job_step_completed	\N	\N	2026-02-07 20:16:15.643	2026-02-07 20:16:15.643		{"job_id":3,"job_name":"Contagem","reason":"timeout","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
133	local:1	\N	job_step_completed	\N	\N	2026-02-07 20:16:15.647	2026-02-07 20:16:15.647		{"job_id":3,"job_name":"Contagem","reason":"timeout","step_id":5,"step_name":"teste final 2","step_order":4}	1
134	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:16:19.194	2026-02-07 20:16:19.194	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495379191.jpg","timestamp":"2026-02-07T20:16:19.194Z"}	0
135	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:16:19.766	2026-02-07 20:16:19.766	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495379759.jpg","timestamp":"2026-02-07T20:16:19.766Z"}	0
136	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:17:19.225	2026-02-07 20:17:19.225	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495439222.jpg","timestamp":"2026-02-07T20:17:19.225Z"}	0
137	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:17:19.755	2026-02-07 20:17:19.755	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495439753.jpg","timestamp":"2026-02-07T20:17:19.755Z"}	0
138	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:18:19.223	2026-02-07 20:18:19.223	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495499220.jpg","timestamp":"2026-02-07T20:18:19.223Z"}	0
139	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:18:19.807	2026-02-07 20:18:19.807	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495499803.jpg","timestamp":"2026-02-07T20:18:19.807Z"}	0
140	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:19:19.28	2026-02-07 20:19:19.28	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495559273.jpg","timestamp":"2026-02-07T20:19:19.280Z"}	0
141	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:19:19.875	2026-02-07 20:19:19.875	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495559870.jpg","timestamp":"2026-02-07T20:19:19.875Z"}	0
142	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:20:19.33	2026-02-07 20:20:19.33	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495619326.jpg","timestamp":"2026-02-07T20:20:19.330Z"}	0
143	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:20:19.875	2026-02-07 20:20:19.875	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495619870.jpg","timestamp":"2026-02-07T20:20:19.875Z"}	0
144	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:21:31.988	2026-02-07 20:21:31.988	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495691984.jpg","timestamp":"2026-02-07T20:21:31.988Z"}	0
145	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:21:42.06	2026-02-07 20:21:42.06	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495702054.jpg","timestamp":"2026-02-07T20:21:42.060Z"}	0
146	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:22:32.051	2026-02-07 20:22:32.051	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495752049.jpg","timestamp":"2026-02-07T20:22:32.051Z"}	0
147	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:22:42.109	2026-02-07 20:22:42.109	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495762104.jpg","timestamp":"2026-02-07T20:22:42.109Z"}	0
148	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:23:32.084	2026-02-07 20:23:32.084	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495812082.jpg","timestamp":"2026-02-07T20:23:32.084Z"}	0
149	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:23:42.138	2026-02-07 20:23:42.138	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495822137.jpg","timestamp":"2026-02-07T20:23:42.138Z"}	0
150	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:24:46.065	2026-02-07 20:24:46.065	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495886064.jpg","timestamp":"2026-02-07T20:24:46.065Z"}	0
151	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:24:46.392	2026-02-07 20:24:46.392	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495886391.jpg","timestamp":"2026-02-07T20:24:46.392Z"}	0
152	local:1	\N	job_stop_requested	\N	\N	2026-02-07 20:25:34.373	2026-02-07 20:25:34.373	Job "Contagem" stop requested.	\N	0
153	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:25:46.093	2026-02-07 20:25:46.093	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770495946089.jpg","timestamp":"2026-02-07T20:25:46.093Z"}	0
154	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:25:46.418	2026-02-07 20:25:46.418	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770495946416.jpg","timestamp":"2026-02-07T20:25:46.418Z"}	0
155	local:1	\N	job_stopped	\N	\N	2026-02-07 20:25:47.932	2026-02-07 20:25:47.932	Job "Contagem" stopped (acknowledged by EXE).	\N	0
156	local:1	\N	job_stopped	\N	\N	2026-02-07 20:25:48.091	2026-02-07 20:25:48.091		{"job_id":3,"reason":"cancelled"}	1
157	local:1	\N	job_started	\N	\N	2026-02-07 20:28:18.47	2026-02-07 20:28:18.47		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-07","local_time":"17:28","schedule_day":{"day_name":"Saturday","day_of_month":null,"day_of_week":6,"id":78,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-07T20:28:05.021Z","window":{"end_time":"23:00","id":78,"start_time":"17:28"}}}	1
158	local:1	\N	job_step_started	\N	\N	2026-02-07 20:28:18.521	2026-02-07 20:28:18.521		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
159	local:1	\N	job_step_started	\N	\N	2026-02-07 20:28:18.551	2026-02-07 20:28:18.551		{"job_id":3,"job_name":"Contagem","step_id":5,"step_name":"teste final 2","step_order":4,"targets":0,"timeout_seconds":300}	1
160	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:28:22.712	2026-02-07 20:28:22.712	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770496102710.jpg","timestamp":"2026-02-07T20:28:22.712Z"}	0
161	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:28:22.826	2026-02-07 20:28:22.826	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770496102823.jpg","timestamp":"2026-02-07T20:28:22.826Z"}	0
162	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:29:22.741	2026-02-07 20:29:22.741	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770496162737.jpg","timestamp":"2026-02-07T20:29:22.741Z"}	0
163	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:29:22.874	2026-02-07 20:29:22.874	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770496162870.jpg","timestamp":"2026-02-07T20:29:22.874Z"}	0
164	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:30:22.761	2026-02-07 20:30:22.761	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770496222757.jpg","timestamp":"2026-02-07T20:30:22.761Z"}	0
165	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:30:22.877	2026-02-07 20:30:22.877	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770496222874.jpg","timestamp":"2026-02-07T20:30:22.877Z"}	0
166	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:31:22.8	2026-02-07 20:31:22.8	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770496282798.jpg","timestamp":"2026-02-07T20:31:22.800Z"}	0
167	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:31:22.913	2026-02-07 20:31:22.913	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770496282912.jpg","timestamp":"2026-02-07T20:31:22.913Z"}	0
168	local:1	\N	job_stop_requested	\N	\N	2026-02-07 20:31:26.038	2026-02-07 20:31:26.038	Job "Contagem" stop requested.	\N	0
169	local:1	\N	job_stopped	\N	\N	2026-02-07 20:31:34.218	2026-02-07 20:31:34.218	Job "Contagem" stopped (acknowledged by EXE).	\N	0
170	local:1	\N	job_step_completed	\N	\N	2026-02-07 20:31:34.694	2026-02-07 20:31:34.694		{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
171	local:1	\N	job_step_completed	\N	\N	2026-02-07 20:31:34.709	2026-02-07 20:31:34.709		{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":5,"step_name":"teste final 2","step_order":4}	1
172	local:1	\N	job_stopped	\N	\N	2026-02-07 20:31:34.728	2026-02-07 20:31:34.728		{"job_id":3,"reason":"cancelled"}	1
173	local:1	\N	job_started	\N	\N	2026-02-07 20:41:19.308	2026-02-07 20:41:19.308		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-07","local_time":"17:41","schedule_day":{"day_name":"Saturday","day_of_month":null,"day_of_week":6,"id":85,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-07T20:41:05.014Z","window":{"end_time":"23:00","id":85,"start_time":"17:41"}}}	1
174	local:1	\N	job_step_started	\N	\N	2026-02-07 20:41:19.34	2026-02-07 20:41:19.34		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
175	local:1	\N	job_step_started	\N	\N	2026-02-07 20:41:19.342	2026-02-07 20:41:19.342		{"job_id":3,"job_name":"Contagem","step_id":5,"step_name":"teste final 2","step_order":4,"targets":0,"timeout_seconds":300}	1
176	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:41:23.092	2026-02-07 20:41:23.092	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770496883091.jpg","timestamp":"2026-02-07T20:41:23.092Z"}	0
177	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:41:23.571	2026-02-07 20:41:23.571	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770496883569.jpg","timestamp":"2026-02-07T20:41:23.571Z"}	0
178	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:42:23.123	2026-02-07 20:42:23.123	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770496943120.jpg","timestamp":"2026-02-07T20:42:23.123Z"}	0
179	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:42:23.592	2026-02-07 20:42:23.592	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770496943587.jpg","timestamp":"2026-02-07T20:42:23.592Z"}	0
180	local:1	3	camera_connection_failed	\N	\N	2026-02-07 20:42:24.474	2026-02-07 20:42:24.474	Failed to connect to camera.	{"error":"Capture stalled: EOF","rtsp_url":"rtsp://admin:Mibo2025*@192.168.0.31:554/cam/realmonitor?channel=1&subtype=0|rtsp://admin:Mibo2025*@192.168.0.31:554/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif|rtsp://192.168.0.31/user=admin&password=Mibo2025*&channel=1&stream=0.sdp?"}	1
181	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:43:23.112	2026-02-07 20:43:23.112	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497003108.jpg","timestamp":"2026-02-07T20:43:23.112Z"}	0
182	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:43:23.637	2026-02-07 20:43:23.637	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497003634.jpg","timestamp":"2026-02-07T20:43:23.637Z"}	0
183	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:44:23.149	2026-02-07 20:44:23.149	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497063146.jpg","timestamp":"2026-02-07T20:44:23.149Z"}	0
184	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:44:23.642	2026-02-07 20:44:23.642	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497063636.jpg","timestamp":"2026-02-07T20:44:23.642Z"}	0
185	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:45:23.182	2026-02-07 20:45:23.182	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497123180.jpg","timestamp":"2026-02-07T20:45:23.182Z"}	0
186	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:45:23.711	2026-02-07 20:45:23.711	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497123707.jpg","timestamp":"2026-02-07T20:45:23.711Z"}	0
187	local:1	\N	job_step_completed	\N	\N	2026-02-07 20:46:19.508	2026-02-07 20:46:19.508		{"job_id":3,"job_name":"Contagem","reason":"timeout","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
188	local:1	\N	job_step_completed	\N	\N	2026-02-07 20:46:19.53	2026-02-07 20:46:19.53		{"job_id":3,"job_name":"Contagem","reason":"timeout","step_id":5,"step_name":"teste final 2","step_order":4}	1
189	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:46:23.194	2026-02-07 20:46:23.194	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497183189.jpg","timestamp":"2026-02-07T20:46:23.194Z"}	0
190	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:46:23.71	2026-02-07 20:46:23.71	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497183705.jpg","timestamp":"2026-02-07T20:46:23.710Z"}	0
191	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:47:23.233	2026-02-07 20:47:23.233	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497243226.jpg","timestamp":"2026-02-07T20:47:23.233Z"}	0
192	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:47:23.773	2026-02-07 20:47:23.773	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497243771.jpg","timestamp":"2026-02-07T20:47:23.773Z"}	0
193	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:48:23.26	2026-02-07 20:48:23.26	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497303258.jpg","timestamp":"2026-02-07T20:48:23.260Z"}	0
194	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:48:23.825	2026-02-07 20:48:23.825	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497303821.jpg","timestamp":"2026-02-07T20:48:23.825Z"}	0
195	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:49:23.307	2026-02-07 20:49:23.307	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497363301.jpg","timestamp":"2026-02-07T20:49:23.307Z"}	0
196	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:49:23.887	2026-02-07 20:49:23.887	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497363883.jpg","timestamp":"2026-02-07T20:49:23.887Z"}	0
197	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:50:23.335	2026-02-07 20:50:23.335	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497423333.jpg","timestamp":"2026-02-07T20:50:23.335Z"}	0
198	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:50:23.924	2026-02-07 20:50:23.924	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497423920.jpg","timestamp":"2026-02-07T20:50:23.924Z"}	0
199	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:51:23.364	2026-02-07 20:51:23.364	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497483359.jpg","timestamp":"2026-02-07T20:51:23.364Z"}	0
200	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:51:23.967	2026-02-07 20:51:23.967	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497483963.jpg","timestamp":"2026-02-07T20:51:23.967Z"}	0
201	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:53:34.379	2026-02-07 20:53:34.379	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497614377.jpg","timestamp":"2026-02-07T20:53:34.379Z"}	0
202	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:56:00.781	2026-02-07 20:56:00.781	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497760778.jpg","timestamp":"2026-02-07T20:56:00.781Z"}	0
203	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:56:01.012	2026-02-07 20:56:01.012	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497761010.jpg","timestamp":"2026-02-07T20:56:01.012Z"}	0
204	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:57:01.045	2026-02-07 20:57:01.045	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497821043.jpg","timestamp":"2026-02-07T20:57:01.045Z"}	0
205	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:57:02.408	2026-02-07 20:57:02.408	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497822404.jpg","timestamp":"2026-02-07T20:57:02.408Z"}	0
206	local:1	2	camera_connection_failed	\N	\N	2026-02-07 20:58:21.961	2026-02-07 20:58:21.961	Failed to connect to camera.	{"error":"Capture stalled: av_read_frame: Error number -10054 occurred","rtsp_url":"rtsp://admin:Nick2007@192.168.1.64:554/Streaming/Channels/101"}	1
207	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:58:25.706	2026-02-07 20:58:25.706	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497905702.jpg","timestamp":"2026-02-07T20:58:25.706Z"}	0
208	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:58:37.234	2026-02-07 20:58:37.234	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497917233.jpg","timestamp":"2026-02-07T20:58:37.234Z"}	0
209	local:1	3	thumbnail_updated	\N	\N	2026-02-07 20:59:49.578	2026-02-07 20:59:49.578	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770497989575.jpg","timestamp":"2026-02-07T20:59:49.578Z"}	0
210	local:1	2	thumbnail_updated	\N	\N	2026-02-07 20:59:49.847	2026-02-07 20:59:49.847	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770497989841.jpg","timestamp":"2026-02-07T20:59:49.847Z"}	0
211	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:03:46.27	2026-02-07 21:03:46.27	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770498226266.jpg","timestamp":"2026-02-07T21:03:46.270Z"}	0
212	local:1	2	thumbnail_updated	\N	\N	2026-02-07 21:03:46.541	2026-02-07 21:03:46.541	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770498226539.jpg","timestamp":"2026-02-07T21:03:46.541Z"}	0
213	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:07:35.681	2026-02-07 21:07:35.681	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770498455678.jpg","timestamp":"2026-02-07T21:07:35.681Z"}	0
214	local:1	2	thumbnail_updated	\N	\N	2026-02-07 21:07:35.733	2026-02-07 21:07:35.733	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770498455730.jpg","timestamp":"2026-02-07T21:07:35.733Z"}	0
215	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:08:52.786	2026-02-07 21:08:52.786	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770498532784.jpg","timestamp":"2026-02-07T21:08:52.786Z"}	0
216	local:1	2	thumbnail_updated	\N	\N	2026-02-07 21:08:52.991	2026-02-07 21:08:52.991	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770498532989.jpg","timestamp":"2026-02-07T21:08:52.991Z"}	0
217	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:14:25.26	2026-02-07 21:14:25.26	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770498865259.jpg","timestamp":"2026-02-07T21:14:25.260Z"}	0
490	local:1	\N	job_stopped	\N	\N	2026-02-08 20:35:24.984	2026-02-08 20:35:24.984		{"job_id":4,"reason":"cancelled"}	1
218	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:15:43.681	2026-02-07 21:15:43.681	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770498943678.jpg","timestamp":"2026-02-07T21:15:43.681Z"}	0
219	local:1	2	thumbnail_updated	\N	\N	2026-02-07 21:15:43.955	2026-02-07 21:15:43.955	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770498943952.jpg","timestamp":"2026-02-07T21:15:43.955Z"}	0
220	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:17:13.748	2026-02-07 21:17:13.748	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499033741.jpg","timestamp":"2026-02-07T21:17:13.748Z"}	0
221	local:1	2	thumbnail_updated	\N	\N	2026-02-07 21:17:14.033	2026-02-07 21:17:14.033	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770499034028.jpg","timestamp":"2026-02-07T21:17:14.033Z"}	0
222	local:1	2	thumbnail_updated	\N	\N	2026-02-07 21:18:14.11	2026-02-07 21:18:14.11	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770499094105.jpg","timestamp":"2026-02-07T21:18:14.110Z"}	0
223	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:19:19.63	2026-02-07 21:19:19.63	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499159628.jpg","timestamp":"2026-02-07T21:19:19.630Z"}	0
224	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:21:03.091	2026-02-07 21:21:03.091	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499263089.jpg","timestamp":"2026-02-07T21:21:03.091Z"}	0
225	local:1	2	thumbnail_updated	\N	\N	2026-02-07 21:21:22.147	2026-02-07 21:21:22.147	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770499282146.jpg","timestamp":"2026-02-07T21:21:22.147Z"}	0
226	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:23:27.151	2026-02-07 21:23:27.151	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499407148.jpg","timestamp":"2026-02-07T21:23:27.151Z"}	0
227	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:25:45.406	2026-02-07 21:25:45.406	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499545400.jpg","timestamp":"2026-02-07T21:25:45.406Z"}	0
228	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:27:01.442	2026-02-07 21:27:01.442	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499621440.jpg","timestamp":"2026-02-07T21:27:01.442Z"}	0
229	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:28:26.775	2026-02-07 21:28:26.775	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499706770.jpg","timestamp":"2026-02-07T21:28:26.775Z"}	0
230	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:29:30.07	2026-02-07 21:29:30.07	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499770066.jpg","timestamp":"2026-02-07T21:29:30.070Z"}	0
231	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:30:31.6	2026-02-07 21:30:31.6	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499831598.jpg","timestamp":"2026-02-07T21:30:31.600Z"}	0
232	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:31:31.623	2026-02-07 21:31:31.623	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770499891620.jpg","timestamp":"2026-02-07T21:31:31.623Z"}	0
233	local:1	3	thumbnail_updated	\N	\N	2026-02-07 21:34:03.152	2026-02-07 21:34:03.152	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770500043149.jpg","timestamp":"2026-02-07T21:34:03.152Z"}	0
234	local:1	\N	job_stop_requested	\N	\N	2026-02-07 21:34:10.165	2026-02-07 21:34:10.165	Job "Contagem" stop requested.	\N	0
235	local:1	\N	job_stopped	\N	\N	2026-02-07 21:34:14.472	2026-02-07 21:34:14.472	Job "Contagem" stopped (acknowledged by EXE).	\N	0
236	local:1	\N	job_stopped	\N	\N	2026-02-07 21:34:14.549	2026-02-07 21:34:14.549		{"job_id":3,"reason":"cancelled"}	1
237	local:1	\N	job_started	\N	\N	2026-02-08 11:13:14.923	2026-02-08 11:13:14.923		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-08","local_time":"08:13","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":86,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T11:13:05.022Z","window":{"end_time":"23:00","id":86,"start_time":"08:13"}}}	1
238	local:1	\N	job_step_started	\N	\N	2026-02-08 11:13:14.96	2026-02-08 11:13:14.96		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
239	local:1	3	thumbnail_updated	\N	\N	2026-02-08 11:13:19.107	2026-02-08 11:13:19.107	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770549199104.jpg","timestamp":"2026-02-08T11:13:19.107Z"}	0
240	local:1	2	thumbnail_updated	\N	\N	2026-02-08 11:13:19.298	2026-02-08 11:13:19.298	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770549199295.jpg","timestamp":"2026-02-08T11:13:19.298Z"}	0
241	local:1	\N	job_stop_requested	\N	\N	2026-02-08 11:13:52.09	2026-02-08 11:13:52.09	Job "Contagem" stop requested.	\N	0
242	local:1	\N	job_stopped	\N	\N	2026-02-08 11:14:00.045	2026-02-08 11:14:00.045	Job "Contagem" stopped (acknowledged by EXE).	\N	0
243	local:1	\N	job_step_completed	\N	\N	2026-02-08 11:14:04.068	2026-02-08 11:14:04.068		{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
244	local:1	\N	job_stopped	\N	\N	2026-02-08 11:14:04.084	2026-02-08 11:14:04.084		{"job_id":3,"reason":"cancelled"}	1
245	local:1	\N	job_started	\N	\N	2026-02-08 11:51:10.577	2026-02-08 11:51:10.577		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-08","local_time":"08:51","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":93,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T11:51:05.005Z","window":{"end_time":"23:00","id":93,"start_time":"08:51"}}}	1
246	local:1	\N	job_step_started	\N	\N	2026-02-08 11:51:10.624	2026-02-08 11:51:10.624		{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
247	local:1	3	thumbnail_updated	\N	\N	2026-02-08 11:51:14.648	2026-02-08 11:51:14.648	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770551474646.jpg","timestamp":"2026-02-08T11:51:14.648Z"}	0
248	local:1	2	thumbnail_updated	\N	\N	2026-02-08 11:51:14.814	2026-02-08 11:51:14.814	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770551474812.jpg","timestamp":"2026-02-08T11:51:14.814Z"}	0
249	local:1	2	thumbnail_updated	\N	\N	2026-02-08 11:53:48.342	2026-02-08 11:53:48.342	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770551628340.jpg","timestamp":"2026-02-08T11:53:48.342Z"}	0
250	local:1	2	thumbnail_updated	\N	\N	2026-02-08 11:55:06.011	2026-02-08 11:55:06.011	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770551706009.jpg","timestamp":"2026-02-08T11:55:06.011Z"}	0
251	local:1	3	thumbnail_updated	\N	\N	2026-02-08 11:55:44.199	2026-02-08 11:55:44.199	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770551744198.jpg","timestamp":"2026-02-08T11:55:44.199Z"}	0
252	local:1	\N	job_step_completed	\N	\N	2026-02-08 11:56:15.917	2026-02-08 11:56:15.917		{"job_id":3,"job_name":"Contagem","reason":"timeout","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
253	local:1	2	thumbnail_updated	\N	\N	2026-02-08 11:57:07.686	2026-02-08 11:57:07.686	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770551827685.jpg","timestamp":"2026-02-08T11:57:07.686Z"}	0
254	local:1	3	thumbnail_updated	\N	\N	2026-02-08 11:57:22.062	2026-02-08 11:57:22.062	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770551842060.jpg","timestamp":"2026-02-08T11:57:22.062Z"}	0
255	local:1	2	thumbnail_updated	\N	\N	2026-02-08 11:58:14.826	2026-02-08 11:58:14.826	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770551894824.jpg","timestamp":"2026-02-08T11:58:14.826Z"}	0
256	local:1	2	thumbnail_updated	\N	\N	2026-02-08 11:59:29.702	2026-02-08 11:59:29.702	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770551969701.jpg","timestamp":"2026-02-08T11:59:29.702Z"}	0
257	local:1	2	thumbnail_updated	\N	\N	2026-02-08 12:25:45.91	2026-02-08 12:25:45.91	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770553545908.jpg","timestamp":"2026-02-08T12:25:45.910Z"}	0
258	local:1	\N	job_stop_requested	\N	\N	2026-02-08 12:27:46.959	2026-02-08 12:27:46.959	Job "Contagem" stop requested.	\N	0
259	local:1	\N	job_stopped	\N	\N	2026-02-08 12:27:48.132	2026-02-08 12:27:48.132	Job "Contagem" stopped (acknowledged by EXE).	\N	0
260	local:1	\N	job_stopped	\N	\N	2026-02-08 12:27:48.31	2026-02-08 12:27:48.31		{"job_id":3,"reason":"cancelled"}	1
261	local:1	\N	job_started	\N	\N	2026-02-08 12:35:19.506	2026-02-08 12:35:19.506		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"09:35","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":107,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T12:35:05.041Z","window":{"end_time":"23:00","id":107,"start_time":"09:35"}}}	1
262	local:1	\N	job_step_started	\N	\N	2026-02-08 12:35:19.526	2026-02-08 12:35:19.526	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":60}	1
263	local:1	4	thumbnail_updated	\N	\N	2026-02-08 12:35:20.983	2026-02-08 12:35:20.983	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770554120982.jpg","timestamp":"2026-02-08T12:35:20.983Z"}	0
264	local:1	\N	job_step_completed	\N	\N	2026-02-08 12:36:20.392	2026-02-08 12:36:20.392	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
265	local:1	\N	job_step_started	\N	\N	2026-02-08 12:36:20.617	2026-02-08 12:36:20.617	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":60}	1
266	local:1	4	thumbnail_updated	\N	\N	2026-02-08 12:36:21.008	2026-02-08 12:36:21.008	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770554181003.jpg","timestamp":"2026-02-08T12:36:21.008Z"}	0
267	local:1	3	thumbnail_updated	\N	\N	2026-02-08 12:36:24.659	2026-02-08 12:36:24.659	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770554184657.jpg","timestamp":"2026-02-08T12:36:24.659Z"}	0
268	local:1	4	thumbnail_updated	\N	\N	2026-02-08 12:37:21.027	2026-02-08 12:37:21.027	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770554241022.jpg","timestamp":"2026-02-08T12:37:21.027Z"}	0
269	local:1	\N	job_stop_requested	\N	\N	2026-02-08 12:37:25.138	2026-02-08 12:37:25.138	Job "JOB TESTE" stop requested.	\N	0
270	local:1	\N	job_step_completed	\N	\N	2026-02-08 12:37:26.716	2026-02-08 12:37:26.716	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":7,"step_name":"step teste 2","step_order":2}	1
271	local:1	\N	job_completed	\N	\N	2026-02-08 12:37:26.733	2026-02-08 12:37:26.733		{"job_id":4,"job_name":"JOB TESTE"}	1
272	local:1	\N	job_stopped	\N	\N	2026-02-08 12:37:34.876	2026-02-08 12:37:34.876	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
273	local:1	\N	job_started	\N	\N	2026-02-08 12:59:09.45	2026-02-08 12:59:09.45		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"09:59","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":114,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T12:59:05.027Z","window":{"end_time":"23:00","id":114,"start_time":"09:59"}}}	1
274	local:1	\N	job_step_started	\N	\N	2026-02-08 12:59:09.475	2026-02-08 12:59:09.475	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":60}	1
275	local:1	4	thumbnail_updated	\N	\N	2026-02-08 12:59:10.772	2026-02-08 12:59:10.772	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770555550769.jpg","timestamp":"2026-02-08T12:59:10.772Z"}	0
276	local:1	4	thumbnail_updated	\N	\N	2026-02-08 13:00:10.793	2026-02-08 13:00:10.793	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770555610791.jpg","timestamp":"2026-02-08T13:00:10.793Z"}	0
277	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:00:11.594	2026-02-08 13:00:11.594	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
278	local:1	\N	job_step_started	\N	\N	2026-02-08 13:00:11.824	2026-02-08 13:00:11.824	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":60}	1
279	local:1	3	thumbnail_updated	\N	\N	2026-02-08 13:00:15.946	2026-02-08 13:00:15.946	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770555615944.jpg","timestamp":"2026-02-08T13:00:15.946Z"}	0
280	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:01:12.183	2026-02-08 13:01:12.183	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":7,"step_name":"step teste 2","step_order":2}	1
281	local:1	\N	job_step_started	\N	\N	2026-02-08 13:01:12.443	2026-02-08 13:01:12.443	Step #3: step teste 3 started	{"job_id":4,"job_name":"JOB TESTE","step_id":8,"step_name":"step teste 3","step_order":3,"targets":1,"timeout_seconds":60}	1
282	local:1	2	thumbnail_updated	\N	\N	2026-02-08 13:01:16.467	2026-02-08 13:01:16.467	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770555676466.jpg","timestamp":"2026-02-08T13:01:16.467Z"}	0
283	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:02:15.786	2026-02-08 13:02:15.786	Step #3: step teste 3 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":8,"step_name":"step teste 3","step_order":3}	1
284	local:1	\N	job_completed	\N	\N	2026-02-08 13:02:15.79	2026-02-08 13:02:15.79		{"job_id":4,"job_name":"JOB TESTE"}	1
285	local:1	\N	job_started	\N	\N	2026-02-08 13:25:09.279	2026-02-08 13:25:09.279		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"10:25","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":121,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T13:25:05.016Z","window":{"end_time":"23:00","id":121,"start_time":"10:25"}}}	1
286	local:1	\N	job_step_started	\N	\N	2026-02-08 13:25:09.301	2026-02-08 13:25:09.301	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":60}	1
287	local:1	4	thumbnail_updated	\N	\N	2026-02-08 13:25:10.496	2026-02-08 13:25:10.496	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770557110494.jpg","timestamp":"2026-02-08T13:25:10.496Z"}	0
288	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:26:09.503	2026-02-08 13:26:09.503	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
289	local:1	\N	job_step_started	\N	\N	2026-02-08 13:26:09.742	2026-02-08 13:26:09.742	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":60}	1
290	local:1	4	thumbnail_updated	\N	\N	2026-02-08 13:26:10.522	2026-02-08 13:26:10.522	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770557170517.jpg","timestamp":"2026-02-08T13:26:10.522Z"}	0
291	local:1	3	thumbnail_updated	\N	\N	2026-02-08 13:26:13.73	2026-02-08 13:26:13.73	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770557173729.jpg","timestamp":"2026-02-08T13:26:13.730Z"}	0
292	local:1	\N	job_stop_requested	\N	\N	2026-02-08 13:27:03.912	2026-02-08 13:27:03.912	Job "JOB TESTE" stop requested.	\N	0
293	local:1	\N	job_stopped	\N	\N	2026-02-08 13:27:09.548	2026-02-08 13:27:09.548	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
294	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:27:09.846	2026-02-08 13:27:09.846	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
295	local:1	\N	job_stopped	\N	\N	2026-02-08 13:27:09.858	2026-02-08 13:27:09.858		{"job_id":4,"reason":"cancelled"}	1
296	local:1	\N	job_started	\N	\N	2026-02-08 13:34:10.445	2026-02-08 13:34:10.445		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"10:34","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":128,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T13:34:05.014Z","window":{"end_time":"23:00","id":128,"start_time":"10:34"}}}	1
297	local:1	\N	job_step_started	\N	\N	2026-02-08 13:34:10.458	2026-02-08 13:34:10.458	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":60}	1
298	local:1	4	thumbnail_updated	\N	\N	2026-02-08 13:34:11.792	2026-02-08 13:34:11.792	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770557651790.jpg","timestamp":"2026-02-08T13:34:11.792Z"}	0
299	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:35:11.614	2026-02-08 13:35:11.614	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
300	local:1	\N	job_step_started	\N	\N	2026-02-08 13:35:11.851	2026-02-08 13:35:11.851	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":60}	1
301	local:1	3	thumbnail_updated	\N	\N	2026-02-08 13:35:16.039	2026-02-08 13:35:16.039	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770557716037.jpg","timestamp":"2026-02-08T13:35:16.039Z"}	0
302	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:36:14.73	2026-02-08 13:36:14.73	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":7,"step_name":"step teste 2","step_order":2}	1
303	local:1	\N	job_step_started	\N	\N	2026-02-08 13:36:14.975	2026-02-08 13:36:14.975	Step #3: step teste 3 started	{"job_id":4,"job_name":"JOB TESTE","step_id":8,"step_name":"step teste 3","step_order":3,"targets":1,"timeout_seconds":60}	1
304	local:1	2	thumbnail_updated	\N	\N	2026-02-08 13:36:19.089	2026-02-08 13:36:19.089	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770557779086.jpg","timestamp":"2026-02-08T13:36:19.089Z"}	0
305	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:37:18.941	2026-02-08 13:37:18.941	Step #3: step teste 3 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":8,"step_name":"step teste 3","step_order":3}	1
306	local:1	\N	job_completed	\N	\N	2026-02-08 13:37:18.943	2026-02-08 13:37:18.943		{"job_id":4,"job_name":"JOB TESTE"}	1
307	local:1	\N	job_started	\N	\N	2026-02-08 13:42:11.535	2026-02-08 13:42:11.535		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"10:42","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":135,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T13:42:05.017Z","window":{"end_time":"23:00","id":135,"start_time":"10:42"}}}	1
308	local:1	\N	job_step_started	\N	\N	2026-02-08 13:42:11.567	2026-02-08 13:42:11.567	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":60}	1
309	local:1	4	thumbnail_updated	\N	\N	2026-02-08 13:42:12.705	2026-02-08 13:42:12.705	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770558132703.jpg","timestamp":"2026-02-08T13:42:12.705Z"}	0
310	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:43:12.909	2026-02-08 13:43:12.909	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
311	local:1	\N	job_step_started	\N	\N	2026-02-08 13:43:13.132	2026-02-08 13:43:13.132	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":60}	1
312	local:1	3	thumbnail_updated	\N	\N	2026-02-08 13:43:17.369	2026-02-08 13:43:17.369	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770558197368.jpg","timestamp":"2026-02-08T13:43:17.369Z"}	0
313	local:1	\N	job_stop_requested	\N	\N	2026-02-08 13:43:19.026	2026-02-08 13:43:19.026	Job "JOB TESTE" stop requested.	\N	0
314	local:1	\N	job_stopped	\N	\N	2026-02-08 13:43:26.684	2026-02-08 13:43:26.684	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
315	local:1	\N	job_step_completed	\N	\N	2026-02-08 13:43:27.38	2026-02-08 13:43:27.38	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
316	local:1	\N	job_stopped	\N	\N	2026-02-08 13:43:27.385	2026-02-08 13:43:27.385		{"job_id":4,"reason":"cancelled"}	1
317	local:1	\N	job_started	\N	\N	2026-02-08 14:27:08.442	2026-02-08 14:27:08.442		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"11:27","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":142,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T14:27:05.039Z","window":{"end_time":"23:00","id":142,"start_time":"11:27"}}}	1
318	local:1	\N	job_step_started	\N	\N	2026-02-08 14:27:08.482	2026-02-08 14:27:08.482	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":300}	1
319	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:27:09.672	2026-02-08 14:27:09.672	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770560829670.jpg","timestamp":"2026-02-08T14:27:09.672Z"}	0
320	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:28:09.673	2026-02-08 14:28:09.673	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770560889669.jpg","timestamp":"2026-02-08T14:28:09.673Z"}	0
321	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:29:09.689	2026-02-08 14:29:09.689	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770560949684.jpg","timestamp":"2026-02-08T14:29:09.689Z"}	0
322	local:1	\N	job_stop_requested	\N	\N	2026-02-08 14:30:02.394	2026-02-08 14:30:02.394	Job "JOB TESTE" stop requested.	\N	0
323	local:1	\N	job_stopped	\N	\N	2026-02-08 14:30:08.943	2026-02-08 14:30:08.943	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
324	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:30:09.717	2026-02-08 14:30:09.717	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770561009714.jpg","timestamp":"2026-02-08T14:30:09.717Z"}	0
325	local:1	\N	job_step_completed	\N	\N	2026-02-08 14:30:11.88	2026-02-08 14:30:11.88	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
671	local:1	\N	job_step_completed	\N	\N	2026-02-10 12:03:07.906	2026-02-10 12:03:07.906	Step #1: Contagem pessoas ida completed	{"job_id":3,"job_name":"Contagem","reason":"job_cancel","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
327	local:1	\N	job_started	\N	\N	2026-02-08 14:48:17.144	2026-02-08 14:48:17.144		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"11:48","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":149,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T14:48:05.052Z","window":{"end_time":"23:00","id":149,"start_time":"11:48"}}}	1
328	local:1	\N	job_step_started	\N	\N	2026-02-08 14:48:17.178	2026-02-08 14:48:17.178	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
329	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:48:18.486	2026-02-08 14:48:18.486	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770562098483.jpg","timestamp":"2026-02-08T14:48:18.486Z"}	0
330	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:49:18.501	2026-02-08 14:49:18.501	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770562158496.jpg","timestamp":"2026-02-08T14:49:18.501Z"}	0
331	local:1	\N	job_step_started	\N	\N	2026-02-08 14:50:17.245	2026-02-08 14:50:17.245	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":60}	1
332	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:50:18.512	2026-02-08 14:50:18.512	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770562218507.jpg","timestamp":"2026-02-08T14:50:18.512Z"}	0
333	local:1	3	thumbnail_updated	\N	\N	2026-02-08 14:50:21.415	2026-02-08 14:50:21.415	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770562221411.jpg","timestamp":"2026-02-08T14:50:21.415Z"}	0
334	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:51:18.514	2026-02-08 14:51:18.514	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770562278509.jpg","timestamp":"2026-02-08T14:51:18.514Z"}	0
335	local:1	\N	job_step_completed	\N	\N	2026-02-08 14:51:18.97	2026-02-08 14:51:18.97	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":7,"step_name":"step teste 2","step_order":2}	1
336	local:1	\N	job_step_started	\N	\N	2026-02-08 14:51:19.204	2026-02-08 14:51:19.204	Step #3: step teste 3 started	{"job_id":4,"job_name":"JOB TESTE","step_id":8,"step_name":"step teste 3","step_order":3,"targets":1,"timeout_seconds":60}	1
337	local:1	2	thumbnail_updated	\N	\N	2026-02-08 14:51:23.294	2026-02-08 14:51:23.294	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770562283292.jpg","timestamp":"2026-02-08T14:51:23.294Z"}	0
338	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:52:18.534	2026-02-08 14:52:18.534	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770562338530.jpg","timestamp":"2026-02-08T14:52:18.534Z"}	0
339	local:1	\N	job_step_completed	\N	\N	2026-02-08 14:52:19.254	2026-02-08 14:52:19.254	Step #3: step teste 3 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":8,"step_name":"step teste 3","step_order":3}	1
340	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:53:18.562	2026-02-08 14:53:18.562	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770562398558.jpg","timestamp":"2026-02-08T14:53:18.562Z"}	0
341	local:1	\N	job_stop_requested	\N	\N	2026-02-08 14:54:03.244	2026-02-08 14:54:03.244	Job "JOB TESTE" stop requested.	\N	0
342	local:1	\N	job_stopped	\N	\N	2026-02-08 14:54:18.117	2026-02-08 14:54:18.117	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
343	local:1	4	thumbnail_updated	\N	\N	2026-02-08 14:54:18.546	2026-02-08 14:54:18.546	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770562458544.jpg","timestamp":"2026-02-08T14:54:18.546Z"}	0
344	local:1	\N	job_step_completed	\N	\N	2026-02-08 14:54:20.221	2026-02-08 14:54:20.221	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
345	local:1	\N	job_stopped	\N	\N	2026-02-08 14:54:20.222	2026-02-08 14:54:20.222		{"job_id":4,"reason":"cancelled"}	1
346	local:1	\N	job_started	\N	\N	2026-02-08 15:23:08.505	2026-02-08 15:23:08.505		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"12:23","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":156,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T15:23:05.023Z","window":{"end_time":"23:00","id":156,"start_time":"12:23"}}}	1
347	local:1	\N	job_step_started	\N	\N	2026-02-08 15:23:08.51	2026-02-08 15:23:08.51	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
348	local:1	4	thumbnail_updated	\N	\N	2026-02-08 15:23:09.671	2026-02-08 15:23:09.671	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770564189668.jpg","timestamp":"2026-02-08T15:23:09.671Z"}	0
349	local:1	\N	job_step_started	\N	\N	2026-02-08 15:24:08.572	2026-02-08 15:24:08.572	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":60}	1
350	local:1	4	thumbnail_updated	\N	\N	2026-02-08 15:24:09.677	2026-02-08 15:24:09.677	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770564249673.jpg","timestamp":"2026-02-08T15:24:09.677Z"}	0
351	local:1	3	thumbnail_updated	\N	\N	2026-02-08 15:24:12.286	2026-02-08 15:24:12.286	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770564252284.jpg","timestamp":"2026-02-08T15:24:12.286Z"}	0
352	local:1	4	thumbnail_updated	\N	\N	2026-02-08 15:25:09.705	2026-02-08 15:25:09.705	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770564309701.jpg","timestamp":"2026-02-08T15:25:09.705Z"}	0
353	local:1	3	thumbnail_updated	\N	\N	2026-02-08 15:25:12.277	2026-02-08 15:25:12.277	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770564312274.jpg","timestamp":"2026-02-08T15:25:12.277Z"}	0
354	local:1	\N	job_step_completed	\N	\N	2026-02-08 15:25:13.656	2026-02-08 15:25:13.656	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":7,"step_name":"step teste 2","step_order":2}	1
355	local:1	\N	job_step_started	\N	\N	2026-02-08 15:25:13.888	2026-02-08 15:25:13.888	Step #3: step teste 3 started	{"job_id":4,"job_name":"JOB TESTE","step_id":8,"step_name":"step teste 3","step_order":3,"targets":1,"timeout_seconds":600}	1
356	local:1	2	thumbnail_updated	\N	\N	2026-02-08 15:25:17.952	2026-02-08 15:25:17.952	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770564317949.jpg","timestamp":"2026-02-08T15:25:17.952Z"}	0
357	local:1	4	thumbnail_updated	\N	\N	2026-02-08 15:26:09.727	2026-02-08 15:26:09.727	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770564369724.jpg","timestamp":"2026-02-08T15:26:09.727Z"}	0
358	local:1	\N	job_stop_requested	\N	\N	2026-02-08 15:26:10.692	2026-02-08 15:26:10.692	Job "JOB TESTE" stop requested.	\N	0
359	local:1	2	thumbnail_updated	\N	\N	2026-02-08 15:26:18.012	2026-02-08 15:26:18.012	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770564378009.jpg","timestamp":"2026-02-08T15:26:18.012Z"}	0
360	local:1	\N	job_stopped	\N	\N	2026-02-08 15:26:23.928	2026-02-08 15:26:23.928	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
361	local:1	\N	job_step_completed	\N	\N	2026-02-08 15:26:24.857	2026-02-08 15:26:24.857	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
599	local:1	\N	job_stopped	\N	\N	2026-02-09 23:07:02.412	2026-02-09 23:07:02.412	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
362	local:1	\N	job_step_completed	\N	\N	2026-02-08 15:26:29.718	2026-02-08 15:26:29.718	Step #3: step teste 3 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":8,"step_name":"step teste 3","step_order":3}	1
363	local:1	\N	job_stopped	\N	\N	2026-02-08 15:26:29.723	2026-02-08 15:26:29.723		{"job_id":4,"reason":"cancelled"}	1
364	local:1	\N	job_started	\N	\N	2026-02-08 15:43:17.174	2026-02-08 15:43:17.174		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"12:43","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":163,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T15:43:05.038Z","window":{"end_time":"23:00","id":163,"start_time":"12:43"}}}	1
365	local:1	\N	job_step_started	\N	\N	2026-02-08 15:43:17.203	2026-02-08 15:43:17.203	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
366	local:1	4	thumbnail_updated	\N	\N	2026-02-08 15:43:18.365	2026-02-08 15:43:18.365	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770565398364.jpg","timestamp":"2026-02-08T15:43:18.365Z"}	0
367	local:1	4	thumbnail_updated	\N	\N	2026-02-08 15:44:18.384	2026-02-08 15:44:18.384	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770565458379.jpg","timestamp":"2026-02-08T15:44:18.384Z"}	0
368	local:1	\N	job_step_started	\N	\N	2026-02-08 15:45:04.781	2026-02-08 15:45:04.781	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
369	local:1	3	thumbnail_updated	\N	\N	2026-02-08 15:45:08.82	2026-02-08 15:45:08.82	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770565508817.jpg","timestamp":"2026-02-08T15:45:08.820Z"}	0
370	local:1	4	thumbnail_updated	\N	\N	2026-02-08 15:45:18.398	2026-02-08 15:45:18.398	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770565518394.jpg","timestamp":"2026-02-08T15:45:18.398Z"}	0
371	local:1	4	thumbnail_updated	\N	\N	2026-02-08 15:46:18.393	2026-02-08 15:46:18.393	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770565578386.jpg","timestamp":"2026-02-08T15:46:18.393Z"}	0
372	local:1	3	thumbnail_updated	\N	\N	2026-02-08 15:46:21.934	2026-02-08 15:46:21.934	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770565581931.jpg","timestamp":"2026-02-08T15:46:21.934Z"}	0
373	local:1	\N	job_step_completed	\N	\N	2026-02-08 15:47:08.126	2026-02-08 15:47:08.126	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":7,"step_name":"step teste 2","step_order":2}	1
374	local:1	\N	job_step_started	\N	\N	2026-02-08 15:47:08.363	2026-02-08 15:47:08.363	Step #3: step teste 3 started	{"job_id":4,"job_name":"JOB TESTE","step_id":8,"step_name":"step teste 3","step_order":3,"targets":1,"timeout_seconds":600}	1
375	local:1	2	thumbnail_updated	\N	\N	2026-02-08 15:47:12.453	2026-02-08 15:47:12.453	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770565632450.jpg","timestamp":"2026-02-08T15:47:12.453Z"}	0
376	local:1	4	thumbnail_updated	\N	\N	2026-02-08 15:47:18.429	2026-02-08 15:47:18.429	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770565638425.jpg","timestamp":"2026-02-08T15:47:18.429Z"}	0
377	local:1	\N	job_stop_requested	\N	\N	2026-02-08 15:47:27.111	2026-02-08 15:47:27.111	Job "JOB TESTE" stop requested.	\N	0
378	local:1	\N	job_stopped	\N	\N	2026-02-08 15:47:32.767	2026-02-08 15:47:32.767	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
379	local:1	\N	job_step_completed	\N	\N	2026-02-08 15:47:33.602	2026-02-08 15:47:33.602	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
380	local:1	\N	job_step_completed	\N	\N	2026-02-08 15:47:33.794	2026-02-08 15:47:33.794	Step #3: step teste 3 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":8,"step_name":"step teste 3","step_order":3}	1
381	local:1	\N	job_stopped	\N	\N	2026-02-08 15:47:33.81	2026-02-08 15:47:33.81		{"job_id":4,"reason":"cancelled"}	1
382	local:1	\N	job_started	\N	\N	2026-02-08 18:48:11.49	2026-02-08 18:48:11.49		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"15:48","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":170,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T18:48:05.011Z","window":{"end_time":"23:00","id":170,"start_time":"15:48"}}}	1
383	local:1	\N	job_step_started	\N	\N	2026-02-08 18:48:11.515	2026-02-08 18:48:11.515	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
384	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:48:12.844	2026-02-08 18:48:12.844	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770576492842.jpg","timestamp":"2026-02-08T18:48:12.844Z"}	0
385	local:1	\N	job_step_started	\N	\N	2026-02-08 18:48:47.485	2026-02-08 18:48:47.485	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
386	local:1	3	thumbnail_updated	\N	\N	2026-02-08 18:48:51.673	2026-02-08 18:48:51.673	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770576531671.jpg","timestamp":"2026-02-08T18:48:51.673Z"}	0
387	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:49:12.861	2026-02-08 18:49:12.861	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770576552858.jpg","timestamp":"2026-02-08T18:49:12.861Z"}	0
388	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:50:12.879	2026-02-08 18:50:12.879	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770576612874.jpg","timestamp":"2026-02-08T18:50:12.879Z"}	0
389	local:1	\N	job_step_completed	\N	\N	2026-02-08 18:50:47.621	2026-02-08 18:50:47.621	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":7,"step_name":"step teste 2","step_order":2}	1
390	local:1	\N	job_step_started	\N	\N	2026-02-08 18:50:47.835	2026-02-08 18:50:47.835	Step #3: step teste 3 started	{"job_id":4,"job_name":"JOB TESTE","step_id":8,"step_name":"step teste 3","step_order":3,"targets":1,"timeout_seconds":600}	1
391	local:1	2	thumbnail_updated	\N	\N	2026-02-08 18:50:52.307	2026-02-08 18:50:52.307	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770576652305.jpg","timestamp":"2026-02-08T18:50:52.307Z"}	0
392	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:51:12.868	2026-02-08 18:51:12.868	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770576672864.jpg","timestamp":"2026-02-08T18:51:12.868Z"}	0
393	local:1	2	thumbnail_updated	\N	\N	2026-02-08 18:51:54.012	2026-02-08 18:51:54.012	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770576714008.jpg","timestamp":"2026-02-08T18:51:54.012Z"}	0
394	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:52:12.876	2026-02-08 18:52:12.876	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770576732873.jpg","timestamp":"2026-02-08T18:52:12.876Z"}	0
395	local:1	2	thumbnail_updated	\N	\N	2026-02-08 18:52:54.054	2026-02-08 18:52:54.054	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770576774050.jpg","timestamp":"2026-02-08T18:52:54.054Z"}	0
396	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:53:12.89	2026-02-08 18:53:12.89	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770576792882.jpg","timestamp":"2026-02-08T18:53:12.890Z"}	0
397	local:1	2	thumbnail_updated	\N	\N	2026-02-08 18:53:54.129	2026-02-08 18:53:54.129	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770576834125.jpg","timestamp":"2026-02-08T18:53:54.129Z"}	0
398	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:54:12.885	2026-02-08 18:54:12.885	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770576852881.jpg","timestamp":"2026-02-08T18:54:12.885Z"}	0
399	local:1	2	thumbnail_updated	\N	\N	2026-02-08 18:54:54.162	2026-02-08 18:54:54.162	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770576894158.jpg","timestamp":"2026-02-08T18:54:54.162Z"}	0
400	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:55:12.893	2026-02-08 18:55:12.893	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770576912891.jpg","timestamp":"2026-02-08T18:55:12.893Z"}	0
401	local:1	2	thumbnail_updated	\N	\N	2026-02-08 18:55:54.208	2026-02-08 18:55:54.208	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770576954203.jpg","timestamp":"2026-02-08T18:55:54.208Z"}	0
402	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:56:12.911	2026-02-08 18:56:12.911	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770576972906.jpg","timestamp":"2026-02-08T18:56:12.911Z"}	0
403	local:1	2	thumbnail_updated	\N	\N	2026-02-08 18:56:54.236	2026-02-08 18:56:54.236	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770577014232.jpg","timestamp":"2026-02-08T18:56:54.236Z"}	0
404	local:1	4	thumbnail_updated	\N	\N	2026-02-08 18:57:12.912	2026-02-08 18:57:12.912	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770577032908.jpg","timestamp":"2026-02-08T18:57:12.912Z"}	0
405	local:1	\N	job_step_completed	\N	\N	2026-02-08 18:58:12.141	2026-02-08 18:58:12.141	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
406	local:1	2	thumbnail_updated	\N	\N	2026-02-08 18:59:20.79	2026-02-08 18:59:20.79	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770577160782.jpg","timestamp":"2026-02-08T18:59:20.790Z"}	0
407	local:1	2	thumbnail_updated	\N	\N	2026-02-08 19:00:20.83	2026-02-08 19:00:20.83	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770577220827.jpg","timestamp":"2026-02-08T19:00:20.830Z"}	0
408	local:1	\N	job_step_completed	\N	\N	2026-02-08 19:00:48.892	2026-02-08 19:00:48.892	Step #3: step teste 3 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":8,"step_name":"step teste 3","step_order":3}	1
409	local:1	\N	job_completed	\N	\N	2026-02-08 19:00:48.906	2026-02-08 19:00:48.906		{"job_id":4,"job_name":"JOB TESTE"}	1
410	local:1	\N	job_started	\N	\N	2026-02-08 19:17:15.46	2026-02-08 19:17:15.46		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"16:17","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":177,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T19:17:05.029Z","window":{"end_time":"23:00","id":177,"start_time":"16:17"}}}	1
411	local:1	\N	job_step_started	\N	\N	2026-02-08 19:17:15.492	2026-02-08 19:17:15.492	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
412	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:15.496	2026-02-08 19:17:15.496		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
413	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:16.509	2026-02-08 19:17:16.509		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
414	local:1	4	thumbnail_updated	\N	\N	2026-02-08 19:17:16.618	2026-02-08 19:17:16.618	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770578236615.jpg","timestamp":"2026-02-08T19:17:16.618Z"}	0
415	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:17.527	2026-02-08 19:17:17.527		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
416	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:18.537	2026-02-08 19:17:18.537		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
417	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:19.554	2026-02-08 19:17:19.554		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
418	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:20.573	2026-02-08 19:17:20.573		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
419	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:21.583	2026-02-08 19:17:21.583		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
420	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:22.602	2026-02-08 19:17:22.602		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
421	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:23.62	2026-02-08 19:17:23.62		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
422	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:24.629	2026-02-08 19:17:24.629		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
423	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:25.637	2026-02-08 19:17:25.637		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
424	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:42.969	2026-02-08 19:17:42.969		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
425	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:48.189	2026-02-08 19:17:48.189		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
426	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:53.831	2026-02-08 19:17:53.831		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
427	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:54.836	2026-02-08 19:17:54.836		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
672	local:1	\N	job_stopped	\N	\N	2026-02-10 12:03:07.908	2026-02-10 12:03:07.908		{"job_id":3,"reason":"cancelled"}	1
428	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:17:55.843	2026-02-08 19:17:55.843		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
429	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:18:00.888	2026-02-08 19:18:00.888		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
430	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:18:01.895	2026-02-08 19:18:01.895		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
431	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:18:02.912	2026-02-08 19:18:02.912		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
432	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:18:03.921	2026-02-08 19:18:03.921		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
433	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:18:04.94	2026-02-08 19:18:04.94		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
434	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:18:05.95	2026-02-08 19:18:05.95		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
435	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:18:12.644	2026-02-08 19:18:12.644		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
436	local:1	\N	job_alert_triggered	\N	\N	2026-02-08 19:18:13.66	2026-02-08 19:18:13.66		{"camera_id":4,"channel":"telegram","job_id":4,"job_name":"JOB TESTE","message_template":"AHHHH TORCEDOR AVISTADO!","rule_id":2,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
439	local:1	4	thumbnail_updated	\N	\N	2026-02-08 19:18:16.658	2026-02-08 19:18:16.658	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770578296653.jpg","timestamp":"2026-02-08T19:18:16.658Z"}	0
452	local:1	\N	job_stop_requested	\N	\N	2026-02-08 19:18:38.248	2026-02-08 19:18:38.248	Job "JOB TESTE" stop requested.	\N	0
457	local:1	\N	job_stopped	\N	\N	2026-02-08 19:18:45.586	2026-02-08 19:18:45.586	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
458	local:1	\N	job_step_completed	\N	\N	2026-02-08 19:18:46.312	2026-02-08 19:18:46.312	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
459	local:1	\N	job_stopped	\N	\N	2026-02-08 19:18:46.313	2026-02-08 19:18:46.313		{"job_id":4,"reason":"cancelled"}	1
460	local:1	\N	job_started	\N	\N	2026-02-08 20:14:08.255	2026-02-08 20:14:08.255		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"17:14","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":184,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T20:14:05.025Z","window":{"end_time":"23:00","id":184,"start_time":"17:14"}}}	1
461	local:1	\N	job_step_started	\N	\N	2026-02-08 20:14:08.3	2026-02-08 20:14:08.3	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
462	local:1	4	thumbnail_updated	\N	\N	2026-02-08 20:14:09.44	2026-02-08 20:14:09.44	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770581649437.jpg","timestamp":"2026-02-08T20:14:09.440Z"}	0
463	local:1	4	thumbnail_updated	\N	\N	2026-02-08 20:15:09.465	2026-02-08 20:15:09.465	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770581709460.jpg","timestamp":"2026-02-08T20:15:09.465Z"}	0
464	local:1	4	thumbnail_updated	\N	\N	2026-02-08 20:16:09.494	2026-02-08 20:16:09.494	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770581769489.jpg","timestamp":"2026-02-08T20:16:09.494Z"}	0
466	local:1	\N	job_step_started	\N	\N	2026-02-08 20:16:53.721	2026-02-08 20:16:53.721	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
467	local:1	3	thumbnail_updated	\N	\N	2026-02-08 20:16:57.906	2026-02-08 20:16:57.906	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770581817904.jpg","timestamp":"2026-02-08T20:16:57.906Z"}	0
469	local:1	4	thumbnail_updated	\N	\N	2026-02-08 20:17:09.501	2026-02-08 20:17:09.501	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770581829499.jpg","timestamp":"2026-02-08T20:17:09.501Z"}	0
471	local:1	3	thumbnail_updated	\N	\N	2026-02-08 20:17:57.957	2026-02-08 20:17:57.957	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770581877954.jpg","timestamp":"2026-02-08T20:17:57.957Z"}	0
472	local:1	\N	job_stop_requested	\N	\N	2026-02-08 20:18:04.264	2026-02-08 20:18:04.264	Job "JOB TESTE" stop requested.	\N	0
473	local:1	\N	job_stopped	\N	\N	2026-02-08 20:18:08.777	2026-02-08 20:18:08.777	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
474	local:1	4	thumbnail_updated	\N	\N	2026-02-08 20:18:09.526	2026-02-08 20:18:09.526	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770581889522.jpg","timestamp":"2026-02-08T20:18:09.526Z"}	0
475	local:1	\N	job_step_completed	\N	\N	2026-02-08 20:18:10.266	2026-02-08 20:18:10.266	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
476	local:1	\N	job_step_completed	\N	\N	2026-02-08 20:18:14.356	2026-02-08 20:18:14.356	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
477	local:1	\N	job_stopped	\N	\N	2026-02-08 20:18:14.374	2026-02-08 20:18:14.374		{"job_id":4,"reason":"cancelled"}	1
478	local:1	\N	job_started	\N	\N	2026-02-08 20:34:05.985	2026-02-08 20:34:05.985		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-08","local_time":"17:34","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":191,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-08T20:34:05.005Z","window":{"end_time":"23:00","id":191,"start_time":"17:34"}}}	1
479	local:1	\N	job_step_started	\N	\N	2026-02-08 20:34:05.99	2026-02-08 20:34:05.99	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
480	local:1	4	thumbnail_updated	\N	\N	2026-02-08 20:34:07.164	2026-02-08 20:34:07.164	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770582847162.jpg","timestamp":"2026-02-08T20:34:07.164Z"}	0
482	local:1	\N	job_step_started	\N	\N	2026-02-08 20:34:33.503	2026-02-08 20:34:33.503	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
483	local:1	3	thumbnail_updated	\N	\N	2026-02-08 20:34:37.708	2026-02-08 20:34:37.708	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770582877706.jpg","timestamp":"2026-02-08T20:34:37.708Z"}	0
485	local:1	4	thumbnail_updated	\N	\N	2026-02-08 20:35:07.178	2026-02-08 20:35:07.178	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770582907175.jpg","timestamp":"2026-02-08T20:35:07.178Z"}	0
486	local:1	\N	job_stop_requested	\N	\N	2026-02-08 20:35:11.326	2026-02-08 20:35:11.326	Job "JOB TESTE" stop requested.	\N	0
487	local:1	\N	job_stopped	\N	\N	2026-02-08 20:35:21.111	2026-02-08 20:35:21.111	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
488	local:1	\N	job_step_completed	\N	\N	2026-02-08 20:35:24.906	2026-02-08 20:35:24.906	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
489	local:1	\N	job_step_completed	\N	\N	2026-02-08 20:35:24.968	2026-02-08 20:35:24.968	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
492	local:1	\N	job_started	\N	\N	2026-02-09 12:00:09.865	2026-02-09 12:00:09.865		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-09","local_time":"09:00","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":94,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T12:00:05.027Z","window":{"end_time":"17:00","id":94,"start_time":"09:00"}}}	1
491	local:1	\N	job_started	\N	\N	2026-02-09 12:00:09.864	2026-02-09 12:00:09.864		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"09:00","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":192,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T12:00:05.187Z","window":{"end_time":"17:00","id":192,"start_time":"09:00"}}}	1
493	local:1	\N	job_step_started	\N	\N	2026-02-09 12:00:09.896	2026-02-09 12:00:09.896	Step #1: Contagem pessoas ida started	{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
494	local:1	\N	job_step_started	\N	\N	2026-02-09 12:00:09.909	2026-02-09 12:00:09.909	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
495	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:00:11.442	2026-02-09 12:00:11.442	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638411440.jpg","timestamp":"2026-02-09T12:00:11.442Z"}	0
496	local:1	3	thumbnail_updated	\N	\N	2026-02-09 12:00:13.924	2026-02-09 12:00:13.924	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770638413923.jpg","timestamp":"2026-02-09T12:00:13.924Z"}	0
497	local:1	2	thumbnail_updated	\N	\N	2026-02-09 12:00:14.101	2026-02-09 12:00:14.101	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770638414099.jpg","timestamp":"2026-02-09T12:00:14.101Z"}	0
498	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:01:11.454	2026-02-09 12:01:11.454	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638471452.jpg","timestamp":"2026-02-09T12:01:11.454Z"}	0
499	local:1	3	thumbnail_updated	\N	\N	2026-02-09 12:01:29.125	2026-02-09 12:01:29.125	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770638489122.jpg","timestamp":"2026-02-09T12:01:29.125Z"}	0
500	local:1	2	thumbnail_updated	\N	\N	2026-02-09 12:02:00.703	2026-02-09 12:02:00.703	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770638520700.jpg","timestamp":"2026-02-09T12:02:00.703Z"}	0
501	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:02:11.471	2026-02-09 12:02:11.471	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638531470.jpg","timestamp":"2026-02-09T12:02:11.471Z"}	0
502	local:1	3	thumbnail_updated	\N	\N	2026-02-09 12:02:40.263	2026-02-09 12:02:40.263	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770638560261.jpg","timestamp":"2026-02-09T12:02:40.263Z"}	0
503	local:1	2	thumbnail_updated	\N	\N	2026-02-09 12:03:00.746	2026-02-09 12:03:00.746	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770638580744.jpg","timestamp":"2026-02-09T12:03:00.746Z"}	0
504	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:03:11.498	2026-02-09 12:03:11.498	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638591495.jpg","timestamp":"2026-02-09T12:03:11.498Z"}	0
505	local:1	3	thumbnail_updated	\N	\N	2026-02-09 12:03:49.323	2026-02-09 12:03:49.323	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770638629319.jpg","timestamp":"2026-02-09T12:03:49.323Z"}	0
506	local:1	2	thumbnail_updated	\N	\N	2026-02-09 12:04:00.789	2026-02-09 12:04:00.789	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770638640785.jpg","timestamp":"2026-02-09T12:04:00.789Z"}	0
507	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:04:11.511	2026-02-09 12:04:11.511	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638651508.jpg","timestamp":"2026-02-09T12:04:11.511Z"}	0
508	local:1	3	thumbnail_updated	\N	\N	2026-02-09 12:04:53.947	2026-02-09 12:04:53.947	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770638693945.jpg","timestamp":"2026-02-09T12:04:53.947Z"}	0
509	local:1	2	thumbnail_updated	\N	\N	2026-02-09 12:05:00.818	2026-02-09 12:05:00.818	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_2_1770638700815.jpg","timestamp":"2026-02-09T12:05:00.818Z"}	0
510	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:05:11.513	2026-02-09 12:05:11.513	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638711509.jpg","timestamp":"2026-02-09T12:05:11.513Z"}	0
511	local:1	\N	job_step_completed	\N	\N	2026-02-09 12:05:16.01	2026-02-09 12:05:16.01	Step #1: Contagem pessoas ida completed	{"job_id":3,"job_name":"Contagem","reason":"timeout","step_id":2,"step_name":"Contagem pessoas ida","step_order":1}	1
512	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:06:11.552	2026-02-09 12:06:11.552	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638771549.jpg","timestamp":"2026-02-09T12:06:11.552Z"}	0
513	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:07:11.56	2026-02-09 12:07:11.56	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638831557.jpg","timestamp":"2026-02-09T12:07:11.560Z"}	0
514	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:08:11.566	2026-02-09 12:08:11.566	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638891563.jpg","timestamp":"2026-02-09T12:08:11.566Z"}	0
515	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:09:11.598	2026-02-09 12:09:11.598	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770638951596.jpg","timestamp":"2026-02-09T12:09:11.598Z"}	0
516	local:1	\N	job_step_completed	\N	\N	2026-02-09 12:10:10.917	2026-02-09 12:10:10.917	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"timeout","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
517	local:1	\N	job_stop_requested	\N	\N	2026-02-09 12:11:15.314	2026-02-09 12:11:15.314	Job "JOB TESTE" stop requested.	\N	0
518	local:1	\N	job_stop_requested	\N	\N	2026-02-09 12:11:19.545	2026-02-09 12:11:19.545	Job "Contagem" stop requested.	\N	0
519	local:1	\N	job_stopped	\N	\N	2026-02-09 12:11:26.446	2026-02-09 12:11:26.446	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
520	local:1	\N	job_stopped	\N	\N	2026-02-09 12:11:26.446	2026-02-09 12:11:26.446	Job "Contagem" stopped (acknowledged by EXE).	\N	0
521	local:1	\N	job_stopped	\N	\N	2026-02-09 12:11:26.528	2026-02-09 12:11:26.528		{"job_id":4,"reason":"cancelled"}	1
522	local:1	\N	job_stopped	\N	\N	2026-02-09 12:11:26.719	2026-02-09 12:11:26.719		{"job_id":3,"reason":"cancelled"}	1
804	local:1	\N	job_stop_requested	\N	\N	2026-02-13 11:04:31.548	2026-02-13 11:04:31.548	Job "JOB TESTE" stop requested.	\N	0
523	local:1	\N	job_started	\N	\N	2026-02-09 12:24:13.696	2026-02-09 12:24:13.696		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"09:24","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":199,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T12:24:05.041Z","window":{"end_time":"17:00","id":199,"start_time":"09:24"}}}	1
524	local:1	\N	job_step_started	\N	\N	2026-02-09 12:24:13.717	2026-02-09 12:24:13.717	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
525	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:24:14.83	2026-02-09 12:24:14.83	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770639854828.jpg","timestamp":"2026-02-09T12:24:14.830Z"}	0
526	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:25:14.86	2026-02-09 12:25:14.86	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770639914859.jpg","timestamp":"2026-02-09T12:25:14.860Z"}	0
527	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:26:14.886	2026-02-09 12:26:14.886	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770639974884.jpg","timestamp":"2026-02-09T12:26:14.886Z"}	0
528	local:1	\N	job_stop_requested	\N	\N	2026-02-09 12:26:19.945	2026-02-09 12:26:19.945	Job "JOB TESTE" stop requested.	\N	0
529	local:1	\N	job_stopped	\N	\N	2026-02-09 12:26:29.062	2026-02-09 12:26:29.062	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
530	local:1	\N	job_step_completed	\N	\N	2026-02-09 12:26:32.163	2026-02-09 12:26:32.163	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
531	local:1	\N	job_stopped	\N	\N	2026-02-09 12:26:32.164	2026-02-09 12:26:32.164		{"job_id":4,"reason":"cancelled"}	1
532	local:1	\N	job_started	\N	\N	2026-02-09 12:30:19.078	2026-02-09 12:30:19.078		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"09:30","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":206,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T12:30:05.034Z","window":{"end_time":"17:00","id":206,"start_time":"09:30"}}}	1
533	local:1	\N	job_step_started	\N	\N	2026-02-09 12:30:19.094	2026-02-09 12:30:19.094	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
534	local:1	4	thumbnail_updated	\N	\N	2026-02-09 12:30:20.175	2026-02-09 12:30:20.175	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770640220173.jpg","timestamp":"2026-02-09T12:30:20.175Z"}	0
535	local:1	\N	job_stop_requested	\N	\N	2026-02-09 12:30:48.239	2026-02-09 12:30:48.239	Job "JOB TESTE" stop requested.	\N	0
536	local:1	\N	job_stopped	\N	\N	2026-02-09 12:30:49.116	2026-02-09 12:30:49.116	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
537	local:1	\N	job_step_completed	\N	\N	2026-02-09 12:30:52.61	2026-02-09 12:30:52.61	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
538	local:1	\N	job_stopped	\N	\N	2026-02-09 12:30:52.612	2026-02-09 12:30:52.612		{"job_id":4,"reason":"cancelled"}	1
539	local:1	\N	job_started	\N	\N	2026-02-09 13:00:12.931	2026-02-09 13:00:12.931		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"10:00","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":213,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T13:00:05.017Z","window":{"end_time":"17:00","id":213,"start_time":"10:00"}}}	1
540	local:1	\N	job_step_started	\N	\N	2026-02-09 13:00:12.939	2026-02-09 13:00:12.939	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
541	local:1	4	thumbnail_updated	\N	\N	2026-02-09 13:00:14.05	2026-02-09 13:00:14.05	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770642014043.jpg","timestamp":"2026-02-09T13:00:14.050Z"}	0
542	local:1	\N	job_stop_requested	\N	\N	2026-02-09 13:01:08.008	2026-02-09 13:01:08.008	Job "JOB TESTE" stop requested.	\N	0
543	local:1	\N	job_stopped	\N	\N	2026-02-09 13:01:13.007	2026-02-09 13:01:13.007	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
544	local:1	\N	job_step_completed	\N	\N	2026-02-09 13:01:13.681	2026-02-09 13:01:13.681	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
545	local:1	\N	job_stopped	\N	\N	2026-02-09 13:01:13.697	2026-02-09 13:01:13.697		{"job_id":4,"reason":"cancelled"}	1
546	local:1	\N	job_started	\N	\N	2026-02-09 14:29:10.193	2026-02-09 14:29:10.193		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"11:29","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":220,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T14:29:05.035Z","window":{"end_time":"17:00","id":220,"start_time":"11:29"}}}	1
547	local:1	\N	job_step_started	\N	\N	2026-02-09 14:29:10.205	2026-02-09 14:29:10.205	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
548	local:1	4	thumbnail_updated	\N	\N	2026-02-09 14:29:11.459	2026-02-09 14:29:11.459	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770647351457.jpg","timestamp":"2026-02-09T14:29:11.459Z"}	0
549	local:1	4	thumbnail_updated	\N	\N	2026-02-09 14:30:11.539	2026-02-09 14:30:11.539	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770647411527.jpg","timestamp":"2026-02-09T14:30:11.539Z"}	0
550	local:1	\N	job_stop_requested	\N	\N	2026-02-09 14:30:27.664	2026-02-09 14:30:27.664	Job "JOB TESTE" stop requested.	\N	0
551	local:1	\N	job_stopped	\N	\N	2026-02-09 14:30:40.292	2026-02-09 14:30:40.292	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
552	local:1	\N	job_step_completed	\N	\N	2026-02-09 14:30:40.778	2026-02-09 14:30:40.778	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
553	local:1	\N	job_stopped	\N	\N	2026-02-09 14:30:40.781	2026-02-09 14:30:40.781		{"job_id":4,"reason":"cancelled"}	1
554	local:1	\N	job_started	\N	\N	2026-02-09 16:11:19.524	2026-02-09 16:11:19.524		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"13:11","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":227,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T16:11:05.041Z","window":{"end_time":"17:00","id":227,"start_time":"13:11"}}}	1
555	local:1	\N	job_step_started	\N	\N	2026-02-09 16:11:19.576	2026-02-09 16:11:19.576	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
556	local:1	4	thumbnail_updated	\N	\N	2026-02-09 16:11:21.133	2026-02-09 16:11:21.133	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770653481130.jpg","timestamp":"2026-02-09T16:11:21.133Z"}	0
557	local:1	\N	job_stop_requested	\N	\N	2026-02-09 16:12:09.292	2026-02-09 16:12:09.292	Job "JOB TESTE" stop requested.	\N	0
558	local:1	\N	job_stopped	\N	\N	2026-02-09 16:12:19.666	2026-02-09 16:12:19.666	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
559	local:1	\N	job_step_completed	\N	\N	2026-02-09 16:12:20.214	2026-02-09 16:12:20.214	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
560	local:1	\N	job_stopped	\N	\N	2026-02-09 16:12:20.216	2026-02-09 16:12:20.216		{"job_id":4,"reason":"cancelled"}	1
561	local:1	\N	job_started	\N	\N	2026-02-09 16:17:08.045	2026-02-09 16:17:08.045		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"13:17","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":248,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T16:17:05.067Z","window":{"end_time":"17:00","id":248,"start_time":"13:17"}}}	1
726	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:56:08.794	2026-02-10 17:56:08.794	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746168791.jpg","timestamp":"2026-02-10T17:56:08.794Z"}	0
562	local:1	\N	job_step_started	\N	\N	2026-02-09 16:17:08.053	2026-02-09 16:17:08.053	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
563	local:1	4	thumbnail_updated	\N	\N	2026-02-09 16:17:09.422	2026-02-09 16:17:09.422	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770653829420.jpg","timestamp":"2026-02-09T16:17:09.422Z"}	0
564	local:1	4	thumbnail_updated	\N	\N	2026-02-09 16:18:09.472	2026-02-09 16:18:09.472	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770653889469.jpg","timestamp":"2026-02-09T16:18:09.472Z"}	0
565	local:1	4	thumbnail_updated	\N	\N	2026-02-09 16:19:09.485	2026-02-09 16:19:09.485	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770653949480.jpg","timestamp":"2026-02-09T16:19:09.485Z"}	0
566	local:1	\N	job_stop_requested	\N	\N	2026-02-09 16:19:11.447	2026-02-09 16:19:11.447	Job "JOB TESTE" stop requested.	\N	0
567	local:1	\N	job_stopped	\N	\N	2026-02-09 16:19:23.348	2026-02-09 16:19:23.348	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
568	local:1	\N	job_step_completed	\N	\N	2026-02-09 16:19:24.731	2026-02-09 16:19:24.731	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
569	local:1	\N	job_stopped	\N	\N	2026-02-09 16:19:24.752	2026-02-09 16:19:24.752		{"job_id":4,"reason":"cancelled"}	1
570	local:1	\N	job_started	\N	\N	2026-02-09 16:20:09.815	2026-02-09 16:20:09.815		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"13:20","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":255,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T16:20:05.049Z","window":{"end_time":"17:00","id":255,"start_time":"13:20"}}}	1
571	local:1	\N	job_step_started	\N	\N	2026-02-09 16:20:09.835	2026-02-09 16:20:09.835	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
572	local:1	4	thumbnail_updated	\N	\N	2026-02-09 16:20:11.278	2026-02-09 16:20:11.278	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770654011276.jpg","timestamp":"2026-02-09T16:20:11.278Z"}	0
573	local:1	4	thumbnail_updated	\N	\N	2026-02-09 16:21:11.348	2026-02-09 16:21:11.348	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770654071336.jpg","timestamp":"2026-02-09T16:21:11.348Z"}	0
574	local:1	4	thumbnail_updated	\N	\N	2026-02-09 16:22:11.358	2026-02-09 16:22:11.358	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770654131356.jpg","timestamp":"2026-02-09T16:22:11.358Z"}	0
575	local:1	\N	job_stop_requested	\N	\N	2026-02-09 16:22:29.262	2026-02-09 16:22:29.262	Job "JOB TESTE" stop requested.	\N	0
576	local:1	\N	job_stopped	\N	\N	2026-02-09 16:22:40.37	2026-02-09 16:22:40.37	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
577	local:1	\N	job_step_completed	\N	\N	2026-02-09 16:22:41.521	2026-02-09 16:22:41.521	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
578	local:1	\N	job_stopped	\N	\N	2026-02-09 16:22:41.523	2026-02-09 16:22:41.523		{"job_id":4,"reason":"cancelled"}	1
579	local:1	\N	job_started	\N	\N	2026-02-09 16:26:12.034	2026-02-09 16:26:12.034		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"13:26","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":262,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T16:26:05.019Z","window":{"end_time":"17:00","id":262,"start_time":"13:26"}}}	1
580	local:1	\N	job_step_started	\N	\N	2026-02-09 16:26:12.04	2026-02-09 16:26:12.04	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
581	local:1	4	thumbnail_updated	\N	\N	2026-02-09 16:26:13.385	2026-02-09 16:26:13.385	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770654373383.jpg","timestamp":"2026-02-09T16:26:13.385Z"}	0
582	local:1	4	thumbnail_updated	\N	\N	2026-02-09 16:27:13.439	2026-02-09 16:27:13.439	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770654433435.jpg","timestamp":"2026-02-09T16:27:13.439Z"}	0
583	local:1	\N	job_stop_requested	\N	\N	2026-02-09 16:27:36.45	2026-02-09 16:27:36.45	Job "JOB TESTE" stop requested.	\N	0
584	local:1	\N	job_stopped	\N	\N	2026-02-09 16:27:42.2	2026-02-09 16:27:42.2	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
585	local:1	\N	job_step_completed	\N	\N	2026-02-09 16:27:42.777	2026-02-09 16:27:42.777	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
586	local:1	\N	job_stopped	\N	\N	2026-02-09 16:27:42.779	2026-02-09 16:27:42.779		{"job_id":4,"reason":"cancelled"}	1
587	local:1	\N	job_started	\N	\N	2026-02-09 17:10:05.991	2026-02-09 17:10:05.991		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"14:10","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":269,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-09T17:10:05.050Z","window":{"end_time":"17:00","id":269,"start_time":"14:10"}}}	1
588	local:1	\N	job_step_started	\N	\N	2026-02-09 17:10:06.02	2026-02-09 17:10:06.02	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
589	local:1	4	thumbnail_updated	\N	\N	2026-02-09 17:10:07.464	2026-02-09 17:10:07.464	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770657007461.jpg","timestamp":"2026-02-09T17:10:07.464Z"}	0
590	local:1	\N	job_stop_requested	\N	\N	2026-02-09 17:10:52.441	2026-02-09 17:10:52.441	Job "JOB TESTE" stop requested.	\N	0
591	local:1	\N	job_stopped	\N	\N	2026-02-09 17:11:06.068	2026-02-09 17:11:06.068	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
592	local:1	\N	job_step_completed	\N	\N	2026-02-09 17:11:06.658	2026-02-09 17:11:06.658	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
593	local:1	\N	job_stopped	\N	\N	2026-02-09 17:11:06.66	2026-02-09 17:11:06.66		{"job_id":4,"reason":"cancelled"}	1
805	local:1	\N	job_stopped	\N	\N	2026-02-13 11:04:40.161	2026-02-13 11:04:40.161	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
949	local:1	\N	job_stop_requested	\N	\N	2026-02-13 21:42:09.636	2026-02-13 21:42:09.636	Job "JOB TESTE" stop requested.	\N	0
594	local:1	\N	job_started	\N	\N	2026-02-09 23:05:17.195	2026-02-09 23:05:17.195		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"20:05","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":276,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-09T23:05:05.019Z","window":{"end_time":"23:00","id":276,"start_time":"20:05"}}}	1
595	local:1	\N	job_step_started	\N	\N	2026-02-09 23:05:17.246	2026-02-09 23:05:17.246	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
596	local:1	4	thumbnail_updated	\N	\N	2026-02-09 23:05:18.712	2026-02-09 23:05:18.712	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770678318710.jpg","timestamp":"2026-02-09T23:05:18.712Z"}	0
597	local:1	4	thumbnail_updated	\N	\N	2026-02-09 23:06:18.721	2026-02-09 23:06:18.721	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770678378717.jpg","timestamp":"2026-02-09T23:06:18.721Z"}	0
598	local:1	\N	job_stop_requested	\N	\N	2026-02-09 23:06:54.378	2026-02-09 23:06:54.378	Job "JOB TESTE" stop requested.	\N	0
600	local:1	\N	job_step_completed	\N	\N	2026-02-09 23:07:07.015	2026-02-09 23:07:07.015	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
601	local:1	\N	job_stopped	\N	\N	2026-02-09 23:07:07.031	2026-02-09 23:07:07.031		{"job_id":4,"reason":"cancelled"}	1
602	local:1	\N	job_started	\N	\N	2026-02-10 00:04:12.761	2026-02-10 00:04:12.761		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"21:04","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":304,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T00:04:05.019Z","window":{"end_time":"23:00","id":304,"start_time":"21:04"}}}	1
603	local:1	\N	job_step_started	\N	\N	2026-02-10 00:04:12.795	2026-02-10 00:04:12.795	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
604	local:1	4	thumbnail_updated	\N	\N	2026-02-10 00:04:14.362	2026-02-10 00:04:14.362	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770681854358.jpg","timestamp":"2026-02-10T00:04:14.362Z"}	0
607	local:1	4	thumbnail_updated	\N	\N	2026-02-10 00:05:14.389	2026-02-10 00:05:14.389	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770681914386.jpg","timestamp":"2026-02-10T00:05:14.389Z"}	0
610	local:1	\N	job_stop_requested	\N	\N	2026-02-10 00:05:42.1	2026-02-10 00:05:42.1	Job "JOB TESTE" stop requested.	\N	0
611	local:1	\N	job_stopped	\N	\N	2026-02-10 00:05:42.842	2026-02-10 00:05:42.842	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
612	local:1	\N	job_step_completed	\N	\N	2026-02-10 00:05:43.406	2026-02-10 00:05:43.406	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
613	local:1	\N	job_stopped	\N	\N	2026-02-10 00:05:43.409	2026-02-10 00:05:43.409		{"job_id":4,"reason":"cancelled"}	1
614	local:1	\N	job_started	\N	\N	2026-02-10 00:50:07.117	2026-02-10 00:50:07.117		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-09","local_time":"21:50","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":318,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T00:50:05.049Z","window":{"end_time":"23:00","id":318,"start_time":"21:50"}}}	1
615	local:1	\N	job_step_started	\N	\N	2026-02-10 00:50:07.127	2026-02-10 00:50:07.127	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
616	local:1	4	thumbnail_updated	\N	\N	2026-02-10 00:50:08.612	2026-02-10 00:50:08.612	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770684608609.jpg","timestamp":"2026-02-10T00:50:08.612Z"}	0
617	local:1	\N	job_stop_requested	\N	\N	2026-02-10 00:50:27.438	2026-02-10 00:50:27.438	Job "JOB TESTE" stop requested.	\N	0
618	local:1	\N	job_stopped	\N	\N	2026-02-10 00:50:37.166	2026-02-10 00:50:37.166	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
619	local:1	\N	job_step_completed	\N	\N	2026-02-10 00:50:37.675	2026-02-10 00:50:37.675	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
620	local:1	\N	job_stopped	\N	\N	2026-02-10 00:50:37.676	2026-02-10 00:50:37.676		{"job_id":4,"reason":"cancelled"}	1
621	local:1	\N	job_started	\N	\N	2026-02-10 10:34:16.489	2026-02-10 10:34:16.489		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-10","local_time":"07:34","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":326,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T10:34:05.031Z","window":{"end_time":"17:00","id":326,"start_time":"07:34"}}}	1
622	local:1	\N	job_step_started	\N	\N	2026-02-10 10:34:16.535	2026-02-10 10:34:16.535	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
623	local:1	4	thumbnail_updated	\N	\N	2026-02-10 10:34:18.014	2026-02-10 10:34:18.014	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770719658008.jpg","timestamp":"2026-02-10T10:34:18.014Z"}	0
760	local:1	\N	job_step_started	\N	\N	2026-02-10 18:15:06.972	2026-02-10 18:15:06.972	Step #1: Passagem RAIO X started	{"job_id":6,"job_name":"Analise Recepcao SAP_C","step_id":12,"step_name":"Passagem RAIO X","step_order":1,"targets":1,"timeout_seconds":5000}	1
761	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:15:09.488	2026-02-10 18:15:09.488	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770747309485.jpg","timestamp":"2026-02-10T18:15:09.488Z"}	0
625	local:1	4	thumbnail_updated	\N	\N	2026-02-10 10:35:18.036	2026-02-10 10:35:18.036	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770719718031.jpg","timestamp":"2026-02-10T10:35:18.036Z"}	0
626	local:1	4	thumbnail_updated	\N	\N	2026-02-10 10:36:18.071	2026-02-10 10:36:18.071	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770719778066.jpg","timestamp":"2026-02-10T10:36:18.071Z"}	0
627	local:1	4	thumbnail_updated	\N	\N	2026-02-10 10:37:18.085	2026-02-10 10:37:18.085	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770719838080.jpg","timestamp":"2026-02-10T10:37:18.085Z"}	0
628	local:1	4	thumbnail_updated	\N	\N	2026-02-10 10:38:18.082	2026-02-10 10:38:18.082	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770719898079.jpg","timestamp":"2026-02-10T10:38:18.082Z"}	0
629	local:1	\N	job_stop_requested	\N	\N	2026-02-10 10:38:29.154	2026-02-10 10:38:29.154	Job "JOB TESTE" stop requested.	\N	0
630	local:1	\N	job_stopped	\N	\N	2026-02-10 10:38:32.346	2026-02-10 10:38:32.346	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
631	local:1	\N	job_step_completed	\N	\N	2026-02-10 10:38:36.998	2026-02-10 10:38:36.998	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
632	local:1	\N	job_stopped	\N	\N	2026-02-10 10:38:36.999	2026-02-10 10:38:36.999		{"job_id":4,"reason":"cancelled"}	1
806	local:1	\N	job_step_completed	\N	\N	2026-02-13 11:04:40.95	2026-02-13 11:04:40.95	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
633	local:1	\N	job_started	\N	\N	2026-02-10 11:03:10.396	2026-02-10 11:03:10.396		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-10","local_time":"08:03","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":333,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T11:03:05.022Z","window":{"end_time":"17:00","id":333,"start_time":"08:03"}}}	1
634	local:1	\N	job_step_started	\N	\N	2026-02-10 11:03:10.407	2026-02-10 11:03:10.407	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
635	local:1	4	thumbnail_updated	\N	\N	2026-02-10 11:03:11.586	2026-02-10 11:03:11.586	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770721391579.jpg","timestamp":"2026-02-10T11:03:11.586Z"}	0
637	local:1	\N	job_stop_requested	\N	\N	2026-02-10 11:03:45.482	2026-02-10 11:03:45.482	Job "JOB TESTE" stop requested.	\N	0
638	local:1	\N	job_stopped	\N	\N	2026-02-10 11:03:55.53	2026-02-10 11:03:55.53	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
639	local:1	\N	job_step_completed	\N	\N	2026-02-10 11:03:58.462	2026-02-10 11:03:58.462	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
640	local:1	\N	job_stopped	\N	\N	2026-02-10 11:03:58.474	2026-02-10 11:03:58.474		{"job_id":4,"reason":"cancelled"}	1
641	local:1	\N	job_started	\N	\N	2026-02-10 11:11:17.936	2026-02-10 11:11:17.936		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-10","local_time":"08:11","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":340,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T11:11:05.017Z","window":{"end_time":"17:00","id":340,"start_time":"08:11"}}}	1
642	local:1	\N	job_step_started	\N	\N	2026-02-10 11:11:17.948	2026-02-10 11:11:17.948	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
643	local:1	4	thumbnail_updated	\N	\N	2026-02-10 11:11:19.194	2026-02-10 11:11:19.194	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770721879192.jpg","timestamp":"2026-02-10T11:11:19.194Z"}	0
645	local:1	\N	job_stop_requested	\N	\N	2026-02-10 11:12:15.178	2026-02-10 11:12:15.178	Job "JOB TESTE" stop requested.	\N	0
646	local:1	\N	job_stopped	\N	\N	2026-02-10 11:12:18.012	2026-02-10 11:12:18.012	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
647	local:1	\N	job_step_completed	\N	\N	2026-02-10 11:12:19.294	2026-02-10 11:12:19.294	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
648	local:1	\N	job_stopped	\N	\N	2026-02-10 11:12:19.295	2026-02-10 11:12:19.295		{"job_id":4,"reason":"cancelled"}	1
649	local:1	\N	job_started	\N	\N	2026-02-10 11:21:14.203	2026-02-10 11:21:14.203		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-10","local_time":"08:21","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":347,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T11:21:05.017Z","window":{"end_time":"17:00","id":347,"start_time":"08:21"}}}	1
650	local:1	\N	job_step_started	\N	\N	2026-02-10 11:21:14.232	2026-02-10 11:21:14.232	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
651	local:1	4	thumbnail_updated	\N	\N	2026-02-10 11:21:15.496	2026-02-10 11:21:15.496	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770722475492.jpg","timestamp":"2026-02-10T11:21:15.496Z"}	0
653	local:1	\N	job_stop_requested	\N	\N	2026-02-10 11:21:38.825	2026-02-10 11:21:38.825	Job "JOB TESTE" stop requested.	\N	0
654	local:1	\N	job_stopped	\N	\N	2026-02-10 11:21:44.239	2026-02-10 11:21:44.239	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
655	local:1	\N	job_step_completed	\N	\N	2026-02-10 11:21:44.991	2026-02-10 11:21:44.991	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
656	local:1	\N	job_stopped	\N	\N	2026-02-10 11:21:44.992	2026-02-10 11:21:44.992		{"job_id":4,"reason":"cancelled"}	1
657	local:1	\N	job_started	\N	\N	2026-02-10 11:30:16.046	2026-02-10 11:30:16.046		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-10","local_time":"08:30","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":354,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T11:30:05.021Z","window":{"end_time":"17:00","id":354,"start_time":"08:30"}}}	1
658	local:1	\N	job_step_started	\N	\N	2026-02-10 11:30:16.061	2026-02-10 11:30:16.061	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
659	local:1	4	thumbnail_updated	\N	\N	2026-02-10 11:30:17.124	2026-02-10 11:30:17.124	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770723017123.jpg","timestamp":"2026-02-10T11:30:17.124Z"}	0
661	local:1	\N	job_stop_requested	\N	\N	2026-02-10 11:30:35.093	2026-02-10 11:30:35.093	Job "JOB TESTE" stop requested.	\N	0
662	local:1	\N	job_stopped	\N	\N	2026-02-10 11:30:46.122	2026-02-10 11:30:46.122	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
663	local:1	\N	job_step_completed	\N	\N	2026-02-10 11:30:47.391	2026-02-10 11:30:47.391	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
664	local:1	\N	job_stopped	\N	\N	2026-02-10 11:30:47.408	2026-02-10 11:30:47.408		{"job_id":4,"reason":"cancelled"}	1
665	local:1	\N	job_started	\N	\N	2026-02-10 12:00:06.664	2026-02-10 12:00:06.664		{"job_id":3,"job_name":"Contagem","trigger":{"local_date":"2026-02-10","local_time":"09:00","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":95,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-10T12:00:05.046Z","window":{"end_time":"17:00","id":95,"start_time":"09:00"}}}	1
666	local:1	\N	job_step_started	\N	\N	2026-02-10 12:00:06.703	2026-02-10 12:00:06.703	Step #1: Contagem pessoas ida started	{"job_id":3,"job_name":"Contagem","step_id":2,"step_name":"Contagem pessoas ida","step_order":1,"targets":2,"timeout_seconds":300}	1
667	local:1	2	camera_connection_failed	\N	\N	2026-02-10 12:00:11.73	2026-02-10 09:00:51.974967	Failed to connect to camera.	{"error":"avformat_open_input: Immediate exit requested","rtsp_url":"rtsp://admin:Nick2007@192.168.1.64:554/Streaming/Channels/101"}	0
668	local:1	3	camera_connection_failed	\N	\N	2026-02-10 12:00:21.793	2026-02-10 09:00:51.974967	Failed to connect to camera.	{"error":"avformat_open_input: Immediate exit requested","rtsp_url":"rtsp://admin:Mibo2025*@192.168.0.31:554/cam/realmonitor?channel=1&subtype=0|rtsp://admin:Mibo2025*@192.168.0.31:554/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif|rtsp://192.168.0.31/user=admin&password=Mibo2025*&channel=1&stream=0.sdp?"}	0
669	local:1	\N	job_stop_requested	\N	\N	2026-02-10 12:03:00.797	2026-02-10 12:03:00.797	Job "Contagem" stop requested.	\N	0
670	local:1	\N	job_stopped	\N	\N	2026-02-10 12:03:07.171	2026-02-10 12:03:07.171	Job "Contagem" stopped (acknowledged by EXE).	\N	0
807	local:1	\N	job_stopped	\N	\N	2026-02-13 11:04:40.951	2026-02-13 11:04:40.951		{"job_id":4,"reason":"cancelled"}	1
673	local:1	\N	job_started	\N	\N	2026-02-10 12:20:10.185	2026-02-10 12:20:10.185		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-10","local_time":"09:20","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":361,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T12:20:05.013Z","window":{"end_time":"17:00","id":361,"start_time":"09:20"}}}	1
674	local:1	\N	job_step_started	\N	\N	2026-02-10 12:20:10.218	2026-02-10 12:20:10.218	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":1,"timeout_seconds":600}	1
675	local:1	4	thumbnail_updated	\N	\N	2026-02-10 12:20:11.226	2026-02-10 12:20:11.226	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770726011223.jpg","timestamp":"2026-02-10T12:20:11.226Z"}	0
677	local:1	4	thumbnail_updated	\N	\N	2026-02-10 12:21:11.228	2026-02-10 12:21:11.228	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770726071224.jpg","timestamp":"2026-02-10T12:21:11.228Z"}	0
678	local:1	4	thumbnail_updated	\N	\N	2026-02-10 12:22:11.276	2026-02-10 12:22:11.276	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770726131269.jpg","timestamp":"2026-02-10T12:22:11.276Z"}	0
679	local:1	\N	job_stop_requested	\N	\N	2026-02-10 12:22:24.477	2026-02-10 12:22:24.477	Job "JOB TESTE" stop requested.	\N	0
680	local:1	\N	job_stopped	\N	\N	2026-02-10 12:22:25.344	2026-02-10 12:22:25.344	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
681	local:1	\N	job_step_completed	\N	\N	2026-02-10 12:22:26.022	2026-02-10 12:22:26.022	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
682	local:1	\N	job_stopped	\N	\N	2026-02-10 12:22:26.023	2026-02-10 12:22:26.023		{"job_id":4,"reason":"cancelled"}	1
683	local:1	7	thumbnail_updated	\N	\N	2026-02-10 12:25:42.743	2026-02-10 12:25:42.743	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_7_1770726342742.jpg","timestamp":"2026-02-10T12:25:42.743Z"}	0
684	local:1	4	thumbnail_updated	\N	\N	2026-02-10 12:26:12.837	2026-02-10 12:26:12.837	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770726372834.jpg","timestamp":"2026-02-10T12:26:12.837Z"}	0
685	local:1	4	thumbnail_updated	\N	\N	2026-02-10 12:26:58.758	2026-02-10 12:26:58.758	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770726418756.jpg","timestamp":"2026-02-10T12:26:58.758Z"}	0
686	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:24:16.705	2026-02-10 17:24:16.705	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770744256703.jpg","timestamp":"2026-02-10T17:24:16.705Z"}	0
687	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:25:16.731	2026-02-10 17:25:16.731	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770744316726.jpg","timestamp":"2026-02-10T17:25:16.731Z"}	0
688	local:1	\N	job_started	\N	\N	2026-02-10 17:35:15.395	2026-02-10 17:35:15.395		{"job_id":6,"job_name":"Analise Recepcao SAP_C","trigger":{"local_date":"2026-02-10","local_time":"14:35","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":382,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T17:35:05.021Z","window":{"end_time":"17:00","id":382,"start_time":"14:35"}}}	1
689	local:1	\N	job_step_started	\N	\N	2026-02-10 17:35:15.423	2026-02-10 17:35:15.423	Step #1: Passagem RAIO X started	{"job_id":6,"job_name":"Analise Recepcao SAP_C","step_id":12,"step_name":"Passagem RAIO X","step_order":1,"targets":1,"timeout_seconds":5000}	1
690	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:35:17.881	2026-02-10 17:35:17.881	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770744917878.jpg","timestamp":"2026-02-10T17:35:17.881Z"}	0
691	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:36:23.203	2026-02-10 17:36:23.203	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770744983200.jpg","timestamp":"2026-02-10T17:36:23.203Z"}	0
780	local:1	\N	job_step_completed	\N	\N	2026-02-11 13:46:15.929	2026-02-11 13:46:15.929	Step #1: Passagem RAIO X completed	{"job_id":6,"job_name":"Analise Recepcao SAP_C","reason":"job_cancel","step_id":12,"step_name":"Passagem RAIO X","step_order":1}	1
781	local:1	\N	job_stopped	\N	\N	2026-02-11 13:46:15.94	2026-02-11 13:46:15.94		{"job_id":6,"reason":"cancelled"}	1
693	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:37:23.196	2026-02-10 17:37:23.196	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770745043191.jpg","timestamp":"2026-02-10T17:37:23.196Z"}	0
694	local:1	\N	job_stop_requested	\N	\N	2026-02-10 17:37:50.092	2026-02-10 17:37:50.092	Job "Analise Recepcao SAP_C" stop requested.	\N	0
696	local:1	\N	job_stopped	\N	\N	2026-02-10 17:38:00.764	2026-02-10 17:38:00.764	Job "Analise Recepcao SAP_C" stopped (acknowledged by EXE).	\N	0
697	local:1	\N	job_step_completed	\N	\N	2026-02-10 17:38:03.44	2026-02-10 17:38:03.44	Step #1: Passagem RAIO X completed	{"job_id":6,"job_name":"Analise Recepcao SAP_C","reason":"job_cancel","step_id":12,"step_name":"Passagem RAIO X","step_order":1}	1
698	local:1	\N	job_stopped	\N	\N	2026-02-10 17:38:03.455	2026-02-10 17:38:03.455		{"job_id":6,"reason":"cancelled"}	1
699	local:1	\N	job_started	\N	\N	2026-02-10 17:43:19.073	2026-02-10 17:43:19.073		{"job_id":6,"job_name":"Analise Recepcao SAP_C","trigger":{"local_date":"2026-02-10","local_time":"14:43","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":389,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T17:43:05.006Z","window":{"end_time":"17:00","id":389,"start_time":"14:43"}}}	1
700	local:1	\N	job_step_started	\N	\N	2026-02-10 17:43:19.106	2026-02-10 17:43:19.106	Step #1: Passagem RAIO X started	{"job_id":6,"job_name":"Analise Recepcao SAP_C","step_id":12,"step_name":"Passagem RAIO X","step_order":1,"targets":1,"timeout_seconds":5000}	1
701	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:43:21.712	2026-02-10 17:43:21.712	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770745401710.jpg","timestamp":"2026-02-10T17:43:21.712Z"}	0
702	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:44:21.735	2026-02-10 17:44:21.735	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770745461728.jpg","timestamp":"2026-02-10T17:44:21.735Z"}	0
704	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:45:21.761	2026-02-10 17:45:21.761	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770745521758.jpg","timestamp":"2026-02-10T17:45:21.761Z"}	0
705	local:1	\N	job_stop_requested	\N	\N	2026-02-10 17:45:46.297	2026-02-10 17:45:46.297	Job "Analise Recepcao SAP_C" stop requested.	\N	0
706	local:1	\N	job_stopped	\N	\N	2026-02-10 17:45:49.381	2026-02-10 17:45:49.381	Job "Analise Recepcao SAP_C" stopped (acknowledged by EXE).	\N	0
707	local:1	\N	job_step_completed	\N	\N	2026-02-10 17:45:49.707	2026-02-10 17:45:49.707	Step #1: Passagem RAIO X completed	{"job_id":6,"job_name":"Analise Recepcao SAP_C","reason":"job_cancel","step_id":12,"step_name":"Passagem RAIO X","step_order":1}	1
708	local:1	\N	job_stopped	\N	\N	2026-02-10 17:45:49.72	2026-02-10 17:45:49.72		{"job_id":6,"reason":"cancelled"}	1
709	local:1	\N	job_started	\N	\N	2026-02-10 17:47:19.921	2026-02-10 17:47:19.921		{"job_id":6,"job_name":"Analise Recepcao SAP_C","trigger":{"local_date":"2026-02-10","local_time":"14:47","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":396,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T17:47:05.007Z","window":{"end_time":"17:00","id":396,"start_time":"14:47"}}}	1
710	local:1	\N	job_step_started	\N	\N	2026-02-10 17:47:19.941	2026-02-10 17:47:19.941	Step #1: Passagem RAIO X started	{"job_id":6,"job_name":"Analise Recepcao SAP_C","step_id":12,"step_name":"Passagem RAIO X","step_order":1,"targets":1,"timeout_seconds":5000}	1
711	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:47:22.377	2026-02-10 17:47:22.377	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770745642374.jpg","timestamp":"2026-02-10T17:47:22.377Z"}	0
713	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:48:22.384	2026-02-10 17:48:22.384	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770745702378.jpg","timestamp":"2026-02-10T17:48:22.384Z"}	0
714	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:49:22.4	2026-02-10 17:49:22.4	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770745762393.jpg","timestamp":"2026-02-10T17:49:22.400Z"}	0
716	local:1	\N	job_stop_requested	\N	\N	2026-02-10 17:50:12.504	2026-02-10 17:50:12.504	Job "Analise Recepcao SAP_C" stop requested.	\N	0
717	local:1	\N	job_stopped	\N	\N	2026-02-10 17:50:20.33	2026-02-10 17:50:20.33	Job "Analise Recepcao SAP_C" stopped (acknowledged by EXE).	\N	0
718	local:1	\N	job_step_completed	\N	\N	2026-02-10 17:50:20.969	2026-02-10 17:50:20.969	Step #1: Passagem RAIO X completed	{"job_id":6,"job_name":"Analise Recepcao SAP_C","reason":"job_cancel","step_id":12,"step_name":"Passagem RAIO X","step_order":1}	1
719	local:1	\N	job_stopped	\N	\N	2026-02-10 17:50:20.98	2026-02-10 17:50:20.98		{"job_id":6,"reason":"cancelled"}	1
720	local:1	\N	job_started	\N	\N	2026-02-10 17:53:06.276	2026-02-10 17:53:06.276		{"job_id":6,"job_name":"Analise Recepcao SAP_C","trigger":{"local_date":"2026-02-10","local_time":"14:53","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":403,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T17:53:05.154Z","window":{"end_time":"17:00","id":403,"start_time":"14:53"}}}	1
721	local:1	\N	job_step_started	\N	\N	2026-02-10 17:53:06.282	2026-02-10 17:53:06.282	Step #1: Passagem RAIO X started	{"job_id":6,"job_name":"Analise Recepcao SAP_C","step_id":12,"step_name":"Passagem RAIO X","step_order":1,"targets":1,"timeout_seconds":5000}	1
722	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:53:08.736	2026-02-10 17:53:08.736	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770745988734.jpg","timestamp":"2026-02-10T17:53:08.736Z"}	0
723	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:54:08.757	2026-02-10 17:54:08.757	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746048754.jpg","timestamp":"2026-02-10T17:54:08.757Z"}	0
724	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:55:08.811	2026-02-10 17:55:08.811	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746108805.jpg","timestamp":"2026-02-10T17:55:08.811Z"}	0
728	local:1	\N	job_stop_requested	\N	\N	2026-02-10 17:56:57.152	2026-02-10 17:56:57.152	Job "Analise Recepcao SAP_C" stop requested.	\N	0
729	local:1	\N	job_stopped	\N	\N	2026-02-10 17:57:06.971	2026-02-10 17:57:06.971	Job "Analise Recepcao SAP_C" stopped (acknowledged by EXE).	\N	0
730	local:1	8	thumbnail_updated	\N	\N	2026-02-10 17:57:08.812	2026-02-10 17:57:08.812	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746228808.jpg","timestamp":"2026-02-10T17:57:08.812Z"}	0
731	local:1	\N	job_step_completed	\N	\N	2026-02-10 17:57:10.127	2026-02-10 17:57:10.127	Step #1: Passagem RAIO X completed	{"job_id":6,"job_name":"Analise Recepcao SAP_C","reason":"job_cancel","step_id":12,"step_name":"Passagem RAIO X","step_order":1}	1
732	local:1	\N	job_stopped	\N	\N	2026-02-10 17:57:10.143	2026-02-10 17:57:10.143		{"job_id":6,"reason":"cancelled"}	1
733	local:1	\N	job_started	\N	\N	2026-02-10 18:01:10.71	2026-02-10 18:01:10.71		{"job_id":6,"job_name":"Analise Recepcao SAP_C","trigger":{"local_date":"2026-02-10","local_time":"15:01","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":410,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T18:01:05.019Z","window":{"end_time":"17:00","id":410,"start_time":"15:01"}}}	1
734	local:1	\N	job_step_started	\N	\N	2026-02-10 18:01:10.724	2026-02-10 18:01:10.724	Step #1: Passagem RAIO X started	{"job_id":6,"job_name":"Analise Recepcao SAP_C","step_id":12,"step_name":"Passagem RAIO X","step_order":1,"targets":1,"timeout_seconds":5000}	1
735	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:01:13.211	2026-02-10 18:01:13.211	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746473208.jpg","timestamp":"2026-02-10T18:01:13.211Z"}	0
736	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:02:13.225	2026-02-10 18:02:13.225	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746533218.jpg","timestamp":"2026-02-10T18:02:13.225Z"}	0
738	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:03:13.205	2026-02-10 18:03:13.205	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746593203.jpg","timestamp":"2026-02-10T18:03:13.205Z"}	0
740	local:1	\N	job_stop_requested	\N	\N	2026-02-10 18:03:59.659	2026-02-10 18:03:59.659	Job "Analise Recepcao SAP_C" stop requested.	\N	0
741	local:1	\N	job_stopped	\N	\N	2026-02-10 18:04:11.075	2026-02-10 18:04:11.075	Job "Analise Recepcao SAP_C" stopped (acknowledged by EXE).	\N	0
742	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:04:13.262	2026-02-10 18:04:13.262	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746653257.jpg","timestamp":"2026-02-10T18:04:13.262Z"}	0
743	local:1	\N	job_step_completed	\N	\N	2026-02-10 18:04:20.14	2026-02-10 18:04:20.14	Step #1: Passagem RAIO X completed	{"job_id":6,"job_name":"Analise Recepcao SAP_C","reason":"job_cancel","step_id":12,"step_name":"Passagem RAIO X","step_order":1}	1
744	local:1	\N	job_stopped	\N	\N	2026-02-10 18:04:20.142	2026-02-10 18:04:20.142		{"job_id":6,"reason":"cancelled"}	1
745	local:1	\N	job_started	\N	\N	2026-02-10 18:08:05.813	2026-02-10 18:08:05.813		{"job_id":6,"job_name":"Analise Recepcao SAP_C","trigger":{"local_date":"2026-02-10","local_time":"15:08","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":417,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T18:08:05.023Z","window":{"end_time":"17:00","id":417,"start_time":"15:08"}}}	1
746	local:1	\N	job_step_started	\N	\N	2026-02-10 18:08:05.819	2026-02-10 18:08:05.819	Step #1: Passagem RAIO X started	{"job_id":6,"job_name":"Analise Recepcao SAP_C","step_id":12,"step_name":"Passagem RAIO X","step_order":1,"targets":1,"timeout_seconds":5000}	1
747	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:08:08.231	2026-02-10 18:08:08.231	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746888227.jpg","timestamp":"2026-02-10T18:08:08.231Z"}	0
749	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:09:08.228	2026-02-10 18:09:08.228	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770746948225.jpg","timestamp":"2026-02-10T18:09:08.228Z"}	0
751	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:10:08.236	2026-02-10 18:10:08.236	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770747008231.jpg","timestamp":"2026-02-10T18:10:08.236Z"}	0
782	local:1	\N	job_started	\N	\N	2026-02-13 10:52:07.993	2026-02-13 10:52:07.993		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"07:52","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":441,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T10:52:05.025Z","window":{"end_time":"17:00","id":441,"start_time":"07:52"}}}	1
752	local:1	\N	job_alert_triggered	\N	\N	2026-02-10 18:10:17.027	2026-02-10 18:10:17.027		{"agent_id":28,"agent_key":"Mochila Raio X","alert_condition_text":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).  Definições visuais do cenário:  Portal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.  Linha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.  Sentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).  Sentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.  Regra obrigatória de orientação (anti-falso-positivo):  Só gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.  “De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.  Se a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.  O que conta como item carregado:  Mochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.  Se estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.","answer":"Uma pessoa carregando uma mochila atravessou o portal \\"GARRETT\\" no sentido de entrada para a recepção, vindo de frente para a câmera.","backend_clip_path":"C:\\\\PerceptrumData\\\\job_alert_clips\\\\cam_8\\\\alert_1770747015945.mp4","camera_id":8,"camera_name":"SAP_C: Recepcao 2","channel":"telegram","clip_path":"C:\\\\Users\\\\nrag2\\\\AppData\\\\Local\\\\Temp\\\\jobsInferencePerceptrum\\\\cam_8\\\\8_20260210_150941_20260210_150951_10s.mp4.processing","job_id":6,"job_name":"Analise Recepcao SAP_C","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","priority_level":"CRITIC","prompt_template":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).\\n\\nDefinições visuais do cenário:\\n\\nPortal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.\\n\\nLinha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.\\n\\nSentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).\\n\\nSentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.\\n\\nRegra obrigatória de orientação (anti-falso-positivo):\\n\\nSó gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.\\n\\n“De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.\\n\\nSe a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.\\n\\nO que conta como item carregado:\\n\\nMochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.\\n\\nSe estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.\\n","rule_id":4,"step_id":12,"step_name":"Passagem RAIO X","step_order":1,"video_url":"/api/job-clips/cam_8/alert_1770747015945.mp4"}	1
753	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:11:08.259	2026-02-10 18:11:08.259	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770747068254.jpg","timestamp":"2026-02-10T18:11:08.259Z"}	0
754	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:12:08.268	2026-02-10 18:12:08.268	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770747128265.jpg","timestamp":"2026-02-10T18:12:08.268Z"}	0
755	local:1	\N	job_stop_requested	\N	\N	2026-02-10 18:12:21.892	2026-02-10 18:12:21.892	Job "Analise Recepcao SAP_C" stop requested.	\N	0
756	local:1	\N	job_stopped	\N	\N	2026-02-10 18:12:36.334	2026-02-10 18:12:36.334	Job "Analise Recepcao SAP_C" stopped (acknowledged by EXE).	\N	0
757	local:1	\N	job_step_completed	\N	\N	2026-02-10 18:12:36.666	2026-02-10 18:12:36.666	Step #1: Passagem RAIO X completed	{"job_id":6,"job_name":"Analise Recepcao SAP_C","reason":"job_cancel","step_id":12,"step_name":"Passagem RAIO X","step_order":1}	1
758	local:1	\N	job_stopped	\N	\N	2026-02-10 18:12:36.685	2026-02-10 18:12:36.685		{"job_id":6,"reason":"cancelled"}	1
759	local:1	\N	job_started	\N	\N	2026-02-10 18:15:06.966	2026-02-10 18:15:06.966		{"job_id":6,"job_name":"Analise Recepcao SAP_C","trigger":{"local_date":"2026-02-10","local_time":"15:15","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":424,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-10T18:15:05.009Z","window":{"end_time":"17:00","id":424,"start_time":"15:15"}}}	1
763	local:1	8	thumbnail_updated	\N	\N	2026-02-10 18:16:09.491	2026-02-10 18:16:09.491	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770747369489.jpg","timestamp":"2026-02-10T18:16:09.491Z"}	0
764	local:1	\N	job_stop_requested	\N	\N	2026-02-10 18:16:16.341	2026-02-10 18:16:16.341	Job "Analise Recepcao SAP_C" stop requested.	\N	0
765	local:1	\N	job_stopped	\N	\N	2026-02-10 18:16:22.119	2026-02-10 18:16:22.119	Job "Analise Recepcao SAP_C" stopped (acknowledged by EXE).	\N	0
766	local:1	\N	job_alert_triggered	\N	\N	2026-02-10 18:16:30.885	2026-02-10 18:16:30.885		{"agent_id":28,"agent_key":"Mochila Raio X","alert_condition_text":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).  Definições visuais do cenário:  Portal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.  Linha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.  Sentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).  Sentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.  Regra obrigatória de orientação (anti-falso-positivo):  Só gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.  “De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.  Se a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.  O que conta como item carregado:  Mochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.  Se estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.","answer":"Duas pessoas atravessaram o portal \\"GARRETT\\" do lado de fora para dentro da recepção, vindo de frente para a câmera e carregando uma bolsa/sacola cada uma.","backend_clip_path":"C:\\\\PerceptrumData\\\\job_alert_clips\\\\cam_8\\\\alert_1770747389870.mp4","camera_id":8,"camera_name":"SAP_C: Recepcao 2","channel":"telegram","clip_path":"C:\\\\Users\\\\nrag2\\\\AppData\\\\Local\\\\Temp\\\\jobsInferencePerceptrum\\\\cam_8\\\\8_20260210_151609_20260210_151619_10s.mp4.processing","job_id":6,"job_name":"Analise Recepcao SAP_C","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","priority_level":"CRITIC","prompt_template":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal com “GARRETT” no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).\\n\\nDefinições visuais do cenário:\\n\\nPortal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.\\n\\nLinha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco, indo do lado de fora para o lado de dentro.\\n\\nSentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e paredes internas).\\n\\nSentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.\\n\\nRegra obrigatória de orientação (anti-falso-positivo):\\n\\nSó gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.\\n\\n“De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.\\n\\nSe a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.\\n\\nO que conta como item carregado:\\n\\nMochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.\\n\\nSe estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.\\n","rule_id":4,"step_id":12,"step_name":"Passagem RAIO X","step_order":1,"video_url":"/api/job-clips/cam_8/alert_1770747389870.mp4"}	1
767	local:1	\N	job_step_completed	\N	\N	2026-02-10 18:16:31.94	2026-02-10 18:16:31.94	Step #1: Passagem RAIO X completed	{"job_id":6,"job_name":"Analise Recepcao SAP_C","reason":"job_cancel","step_id":12,"step_name":"Passagem RAIO X","step_order":1}	1
768	local:1	\N	job_stopped	\N	\N	2026-02-10 18:16:31.956	2026-02-10 18:16:31.956		{"job_id":6,"reason":"cancelled"}	1
769	local:1	\N	job_started	\N	\N	2026-02-11 13:41:14.162	2026-02-11 13:41:14.162		{"job_id":6,"job_name":"Analise Recepcao SAP_C","trigger":{"local_date":"2026-02-11","local_time":"10:41","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":432,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-11T13:41:05.035Z","window":{"end_time":"17:00","id":432,"start_time":"10:41"}}}	1
770	local:1	\N	job_step_started	\N	\N	2026-02-11 13:41:14.194	2026-02-11 13:41:14.194	Step #1: Passagem RAIO X started	{"job_id":6,"job_name":"Analise Recepcao SAP_C","step_id":12,"step_name":"Passagem RAIO X","step_order":1,"targets":1,"timeout_seconds":5000}	1
771	local:1	8	thumbnail_updated	\N	\N	2026-02-11 13:41:16.598	2026-02-11 13:41:16.598	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770817276594.jpg","timestamp":"2026-02-11T13:41:16.598Z"}	0
772	local:1	8	thumbnail_updated	\N	\N	2026-02-11 13:42:16.592	2026-02-11 13:42:16.592	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770817336588.jpg","timestamp":"2026-02-11T13:42:16.592Z"}	0
783	local:1	\N	job_step_started	\N	\N	2026-02-13 10:52:08.053	2026-02-13 10:52:08.053	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
784	local:1	4	thumbnail_updated	\N	\N	2026-02-13 10:52:09.534	2026-02-13 10:52:09.534	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770979929532.jpg","timestamp":"2026-02-13T10:52:09.534Z"}	0
808	local:1	\N	job_started	\N	\N	2026-02-13 11:26:14.236	2026-02-13 11:26:14.236		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"08:26","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":455,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T11:26:05.016Z","window":{"end_time":"17:00","id":455,"start_time":"08:26"}}}	1
773	local:1	\N	job_alert_triggered	\N	\N	2026-02-11 13:42:30.778	2026-02-11 13:42:30.778		{"agent_id":28,"agent_key":"Mochila Raio X","alert_condition_text":"alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).","answer":"Uma pessoa carregando uma mochila atravessou o portal vindo de fora para dentro, de frente para a câmera.","backend_clip_path":"C:\\\\PerceptrumData\\\\job_alert_clips\\\\cam_8\\\\alert_1770817349209.mp4","camera_id":8,"camera_name":"SAP_C: Recepcao 2","channel":"telegram","clip_path":"C:\\\\Users\\\\nrag2\\\\AppData\\\\Local\\\\Temp\\\\jobsInferencePerceptrum\\\\cam_8\\\\8_20260211_104211_20260211_104220_10s.mp4.processing","job_id":6,"job_name":"Analise Recepcao SAP_C","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","priority_level":"HIGH","prompt_template":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).\\n\\nDefinições visuais do cenário:\\n\\nPortal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.\\n\\nLinha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco.\\n\\nSentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e lixeira preta pequena).\\n\\n\\nSentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.\\n\\nRegra obrigatória de orientação (anti-falso-positivo):\\n\\nSó gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.\\n\\n“De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.\\n\\nSe a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.\\n\\nO que conta como item carregado:\\n\\nMochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.\\n\\nSe estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.\\n","rule_id":4,"step_id":12,"step_name":"Passagem RAIO X","step_order":1,"video_url":"/api/job-clips/cam_8/alert_1770817349209.mp4"}	1
774	local:1	8	thumbnail_updated	\N	\N	2026-02-11 13:43:16.661	2026-02-11 13:43:16.661	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770817396654.jpg","timestamp":"2026-02-11T13:43:16.661Z"}	0
775	local:1	8	thumbnail_updated	\N	\N	2026-02-11 13:44:16.671	2026-02-11 13:44:16.671	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770817456668.jpg","timestamp":"2026-02-11T13:44:16.671Z"}	0
776	local:1	\N	job_alert_triggered	\N	\N	2026-02-11 13:44:43.678	2026-02-11 13:44:43.678		{"agent_id":28,"agent_key":"Mochila Raio X","alert_condition_text":"alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).","answer":"Uma pessoa carregando uma mochila atravessou o portal vindo de fora para dentro, de frente para a câmera.","backend_clip_path":"C:\\\\PerceptrumData\\\\job_alert_clips\\\\cam_8\\\\alert_1770817483345.mp4","camera_id":8,"camera_name":"SAP_C: Recepcao 2","channel":"telegram","clip_path":"C:\\\\Users\\\\nrag2\\\\AppData\\\\Local\\\\Temp\\\\jobsInferencePerceptrum\\\\cam_8\\\\8_20260211_104423_20260211_104432_10s.mp4.processing","job_id":6,"job_name":"Analise Recepcao SAP_C","message_template":"Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.","priority_level":"HIGH","prompt_template":"Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).\\n\\nDefinições visuais do cenário:\\n\\nPortal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.\\n\\nLinha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco.\\n\\nSentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e lixeira preta pequena).\\n\\n\\nSentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.\\n\\nRegra obrigatória de orientação (anti-falso-positivo):\\n\\nSó gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.\\n\\n“De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.\\n\\nSe a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.\\n\\nO que conta como item carregado:\\n\\nMochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.\\n\\nSe estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.\\n","rule_id":4,"step_id":12,"step_name":"Passagem RAIO X","step_order":1,"video_url":"/api/job-clips/cam_8/alert_1770817483345.mp4"}	1
777	local:1	8	thumbnail_updated	\N	\N	2026-02-11 13:45:16.705	2026-02-11 13:45:16.705	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_8_1770817516699.jpg","timestamp":"2026-02-11T13:45:16.705Z"}	0
778	local:1	\N	job_stop_requested	\N	\N	2026-02-11 13:46:13.629	2026-02-11 13:46:13.629	Job "Analise Recepcao SAP_C" stop requested.	\N	0
779	local:1	\N	job_stopped	\N	\N	2026-02-11 13:46:14.838	2026-02-11 13:46:14.838	Job "Analise Recepcao SAP_C" stopped (acknowledged by EXE).	\N	0
785	local:1	3	camera_connection_failed	\N	\N	2026-02-13 10:52:23.086	2026-02-13 10:52:23.086	Failed to connect to camera.	{"error":"avformat_open_input: Immediate exit requested","rtsp_url":"rtsp://admin:Mibo2025*@192.168.0.31:554/cam/realmonitor?channel=1&subtype=0|rtsp://admin:Mibo2025*@192.168.0.31:554/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif|rtsp://192.168.0.31/user=admin&password=Mibo2025*&channel=1&stream=0.sdp?"}	1
809	local:1	\N	job_step_started	\N	\N	2026-02-13 11:26:14.248	2026-02-13 11:26:14.248	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
810	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:26:15.451	2026-02-13 11:26:15.451	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770981975448.jpg","timestamp":"2026-02-13T11:26:15.451Z"}	0
842	local:1	\N	job_stopped	\N	\N	2026-02-13 11:59:09.743	2026-02-13 11:59:09.743	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
843	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:59:11.02	2026-02-13 11:59:11.02	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770983951016.jpg","timestamp":"2026-02-13T11:59:11.020Z"}	0
844	local:1	\N	job_step_completed	\N	\N	2026-02-13 11:59:12.754	2026-02-13 11:59:12.754	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
845	local:1	\N	job_stopped	\N	\N	2026-02-13 11:59:12.756	2026-02-13 11:59:12.756		{"job_id":4,"reason":"cancelled"}	1
888	local:1	\N	job_step_completed	\N	\N	2026-02-13 15:22:01.472	2026-02-13 15:22:01.472	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
889	local:1	\N	job_stopped	\N	\N	2026-02-13 15:22:01.487	2026-02-13 15:22:01.487		{"job_id":4,"reason":"cancelled"}	1
950	local:1	\N	job_stopped	\N	\N	2026-02-13 21:42:12.301	2026-02-13 21:42:12.301	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
951	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:42:13.15	2026-02-13 21:42:13.15	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771018933148.jpg","timestamp":"2026-02-13T21:42:13.150Z"}	0
952	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:42:17.229	2026-02-13 21:42:17.229	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
953	local:1	\N	job_stopped	\N	\N	2026-02-13 21:42:17.234	2026-02-13 21:42:17.234		{"job_id":4,"reason":"cancelled"}	1
992	local:1	\N	job_started	\N	\N	2026-02-13 22:11:10.483	2026-02-13 22:11:10.483		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"19:11","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":567,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T22:11:05.022Z","window":{"end_time":"23:00","id":567,"start_time":"19:11"}}}	1
993	local:1	\N	job_step_started	\N	\N	2026-02-13 22:11:10.512	2026-02-13 22:11:10.512	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
994	local:1	4	thumbnail_updated	\N	\N	2026-02-13 22:11:12.04	2026-02-13 22:11:12.04	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771020672037.jpg","timestamp":"2026-02-13T22:11:12.040Z"}	0
995	local:1	3	thumbnail_updated	\N	\N	2026-02-13 22:11:14.622	2026-02-13 22:11:14.622	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771020674619.jpg","timestamp":"2026-02-13T22:11:14.622Z"}	0
1034	local:1	\N	job_stopped	\N	\N	2026-02-13 23:07:45.643	2026-02-13 23:07:45.643	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1035	local:1	\N	job_step_completed	\N	\N	2026-02-13 23:07:46.973	2026-02-13 23:07:46.973	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1036	local:1	\N	job_stopped	\N	\N	2026-02-13 23:07:46.985	2026-02-13 23:07:46.985		{"job_id":4,"reason":"cancelled"}	1
1147	local:1	\N	job_started	\N	\N	2026-02-17 12:56:06.068	2026-02-17 12:56:06.068		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"09:56","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":669,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T12:56:05.049Z","window":{"end_time":"17:00","id":669,"start_time":"09:56"}}}	1
1148	local:1	\N	job_step_started	\N	\N	2026-02-17 12:56:06.107	2026-02-17 12:56:06.107	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1213	local:1	3	thumbnail_updated	\N	\N	2026-02-17 14:07:37.925	2026-02-17 14:07:37.925	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771337257922.jpg","timestamp":"2026-02-17T14:07:37.925Z"}	0
1242	local:1	\N	job_step_started	\N	\N	2026-02-17 15:38:47.706	2026-02-17 15:38:47.706	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1243	local:1	4	thumbnail_updated	\N	\N	2026-02-17 15:38:48.817	2026-02-17 15:38:48.817	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771342728815.jpg","timestamp":"2026-02-17T15:38:48.817Z"}	0
1277	local:1	\N	job_stop_requested	\N	\N	2026-02-17 16:47:14.16	2026-02-17 16:47:14.16	Job "JOB TESTE" stop requested.	\N	0
1278	local:1	\N	job_stopped	\N	\N	2026-02-17 16:47:15.011	2026-02-17 16:47:15.011	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1279	local:1	4	thumbnail_updated	\N	\N	2026-02-17 16:47:16.205	2026-02-17 16:47:16.205	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771346836201.jpg","timestamp":"2026-02-17T16:47:16.205Z"}	0
1280	local:1	\N	job_step_completed	\N	\N	2026-02-17 16:47:16.745	2026-02-17 16:47:16.745	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1281	local:1	\N	job_stopped	\N	\N	2026-02-17 16:47:16.747	2026-02-17 16:47:16.747		{"job_id":4,"reason":"cancelled"}	1
1298	local:1	\N	job_alert_triggered	\N	\N	2026-02-17 17:11:52.391	2026-02-17 17:11:52.391		{"agent_id":-1,"agent_key":"person finder","alert_condition_text":"se achar qualquer pessoa","answer":"Uma pessoa foi detectada sentada em frente a um computador.","backend_image_path":"C:\\\\PerceptrumData\\\\job_alert_images\\\\cam_3\\\\alert_1771348312368.jpg","camera_id":3,"camera_name":"mibo","channel":"none","clip_path":"","group_id":"group-1771342632184-375","group_name":"grupo 1 teste","image_url":"/api/job-images/cam_3/alert_1771348312368.jpg","job_id":4,"job_name":"JOB TESTE","message_template":"","priority_level":"CRITIC","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","rule_id":null,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1299	local:1	\N	job_step_started	\N	\N	2026-02-17 17:11:52.835	2026-02-17 17:11:52.835	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1300	local:1	4	thumbnail_updated	\N	\N	2026-02-17 17:11:54.029	2026-02-17 17:11:54.029	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771348314027.jpg","timestamp":"2026-02-17T17:11:54.029Z"}	0
1322	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:30:08.853	2026-02-18 22:30:08.853	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771453808849.jpg","timestamp":"2026-02-18T22:30:08.853Z"}	0
786	local:1	4	thumbnail_updated	\N	\N	2026-02-13 10:53:09.524	2026-02-13 10:53:09.524	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770979989520.jpg","timestamp":"2026-02-13T10:53:09.524Z"}	0
811	local:1	3	camera_connection_failed	\N	\N	2026-02-13 11:26:29.367	2026-02-13 11:26:29.367	Failed to connect to camera.	{"error":"avformat_open_input: Immediate exit requested","rtsp_url":"rtsp://admin:Mibo2025*@192.168.0.106:554/cam/realmonitor?channel=1&subtype=0|rtsp://admin:Mibo2025*@192.168.0.106:554/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif|rtsp://192.168.0.106/user=admin&password=Mibo2025*&channel=1&stream=0.sdp?"}	1
813	local:1	\N	job_stopped	\N	\N	2026-02-13 11:26:44.296	2026-02-13 11:26:44.296	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
814	local:1	\N	job_step_completed	\N	\N	2026-02-13 11:26:44.665	2026-02-13 11:26:44.665	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
815	local:1	\N	job_stopped	\N	\N	2026-02-13 11:26:44.666	2026-02-13 11:26:44.666		{"job_id":4,"reason":"cancelled"}	1
846	local:1	\N	job_started	\N	\N	2026-02-13 12:00:12.847	2026-02-13 12:00:12.847		{"job_id":6,"job_name":"Analise Recepcao SAP_C","trigger":{"local_date":"2026-02-13","local_time":"09:00","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":434,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Cayenne","trigger_type":"schedule","triggered_at_utc":"2026-02-13T12:00:05.009Z","window":{"end_time":"17:00","id":434,"start_time":"09:00"}}}	1
847	local:1	\N	job_step_started	\N	\N	2026-02-13 12:00:12.858	2026-02-13 12:00:12.858	Step #1: Passagem RAIO X started	{"job_id":6,"job_name":"Analise Recepcao SAP_C","step_id":12,"step_name":"Passagem RAIO X","step_order":1,"targets":1,"timeout_seconds":5000}	1
890	local:1	\N	job_started	\N	\N	2026-02-13 16:04:10.733	2026-02-13 16:04:10.733		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"13:04","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":511,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T16:04:04.999Z","window":{"end_time":"17:00","id":511,"start_time":"13:04"}}}	1
891	local:1	\N	job_step_started	\N	\N	2026-02-13 16:04:10.77	2026-02-13 16:04:10.77	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
892	local:1	4	thumbnail_updated	\N	\N	2026-02-13 16:04:11.908	2026-02-13 16:04:11.908	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770998651906.jpg","timestamp":"2026-02-13T16:04:11.908Z"}	0
893	local:1	3	thumbnail_updated	\N	\N	2026-02-13 16:04:14.971	2026-02-13 16:04:14.971	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770998654969.jpg","timestamp":"2026-02-13T16:04:14.971Z"}	0
954	local:1	\N	job_started	\N	\N	2026-02-13 21:44:16.618	2026-02-13 21:44:16.618		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"18:44","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":546,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T21:44:05.031Z","window":{"end_time":"23:00","id":546,"start_time":"18:44"}}}	1
955	local:1	\N	job_step_started	\N	\N	2026-02-13 21:44:16.633	2026-02-13 21:44:16.633	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
956	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:44:18.146	2026-02-13 21:44:18.146	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771019058144.jpg","timestamp":"2026-02-13T21:44:18.146Z"}	0
957	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:44:20.917	2026-02-13 21:44:20.917	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771019060916.jpg","timestamp":"2026-02-13T21:44:20.917Z"}	0
996	local:1	4	thumbnail_updated	\N	\N	2026-02-13 22:12:12.063	2026-02-13 22:12:12.063	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771020732059.jpg","timestamp":"2026-02-13T22:12:12.063Z"}	0
997	local:1	3	thumbnail_updated	\N	\N	2026-02-13 22:12:15.202	2026-02-13 22:12:15.202	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771020735199.jpg","timestamp":"2026-02-13T22:12:15.202Z"}	0
1037	local:1	\N	job_started	\N	\N	2026-02-13 23:17:07.819	2026-02-13 23:17:07.819		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"20:17","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":602,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T23:17:05.022Z","window":{"end_time":"23:00","id":602,"start_time":"20:17"}}}	1
1038	local:1	\N	job_step_started	\N	\N	2026-02-13 23:17:07.871	2026-02-13 23:17:07.871	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1039	local:1	4	thumbnail_updated	\N	\N	2026-02-13 23:17:09.291	2026-02-13 23:17:09.291	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771024629289.jpg","timestamp":"2026-02-13T23:17:09.291Z"}	0
1040	local:1	3	thumbnail_updated	\N	\N	2026-02-13 23:17:11.977	2026-02-13 23:17:11.977	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771024631975.jpg","timestamp":"2026-02-13T23:17:11.977Z"}	0
1045	local:1	\N	job_started	\N	\N	2026-02-14 15:39:09.611	2026-02-14 15:39:09.611		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-14","local_time":"12:39","schedule_day":{"day_name":"Saturday","day_of_month":null,"day_of_week":6,"id":610,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-14T15:39:05.056Z","window":{"end_time":"17:00","id":610,"start_time":"12:39"}}}	1
1046	local:1	\N	job_step_started	\N	\N	2026-02-14 15:39:09.636	2026-02-14 15:39:09.636	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1047	local:1	4	thumbnail_updated	\N	\N	2026-02-14 15:39:11.074	2026-02-14 15:39:11.074	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771083551072.jpg","timestamp":"2026-02-14T15:39:11.074Z"}	0
1048	local:1	3	thumbnail_updated	\N	\N	2026-02-14 15:39:13.844	2026-02-14 15:39:13.844	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771083553840.jpg","timestamp":"2026-02-14T15:39:13.844Z"}	0
1054	local:1	\N	job_started	\N	\N	2026-02-15 12:38:12.637	2026-02-15 12:38:12.637		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-15","local_time":"09:38","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":611,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-15T12:38:05.033Z","window":{"end_time":"23:00","id":611,"start_time":"09:38"}}}	1
1055	local:1	\N	job_step_started	\N	\N	2026-02-15 12:38:12.66	2026-02-15 12:38:12.66	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1056	local:1	4	thumbnail_updated	\N	\N	2026-02-15 12:38:14.138	2026-02-15 12:38:14.138	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771159094136.jpg","timestamp":"2026-02-15T12:38:14.138Z"}	0
1244	local:1	\N	job_stop_requested	\N	\N	2026-02-17 15:38:58.413	2026-02-17 15:38:58.413	Job "JOB TESTE" stop requested.	\N	0
787	local:1	4	thumbnail_updated	\N	\N	2026-02-13 10:54:09.584	2026-02-13 10:54:09.584	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770980049579.jpg","timestamp":"2026-02-13T10:54:09.584Z"}	0
812	local:1	\N	job_stop_requested	\N	\N	2026-02-13 11:26:32.875	2026-02-13 11:26:32.875	Job "JOB TESTE" stop requested.	\N	0
848	local:1	8	camera_connection_failed	\N	\N	2026-02-13 12:00:27.994	2026-02-13 09:01:14.736389	Failed to connect to camera.	{"error":"avformat_open_input: Immediate exit requested","rtsp_url":"rtsp://admin:ADMcoint2025@10.18.4.96:554/cam/realmonitor?channel=1&subtype=0|rtsp://admin:ADMcoint2025@10.18.4.96:554/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif|rtsp://10.18.4.96/user=admin&password=ADMcoint2025&channel=1&stream=0.sdp?"}	0
895	local:1	\N	job_step_started	\N	\N	2026-02-13 16:05:02.63	2026-02-13 16:05:02.63	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
896	local:1	4	thumbnail_updated	\N	\N	2026-02-13 16:05:03.458	2026-02-13 16:05:03.458	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770998703456.jpg","timestamp":"2026-02-13T16:05:03.458Z"}	0
958	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:45:18.177	2026-02-13 21:45:18.177	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771019118174.jpg","timestamp":"2026-02-13T21:45:18.177Z"}	0
998	local:1	4	thumbnail_updated	\N	\N	2026-02-13 22:13:12.098	2026-02-13 22:13:12.098	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771020792096.jpg","timestamp":"2026-02-13T22:13:12.098Z"}	0
1041	local:1	\N	job_stop_requested	\N	\N	2026-02-13 23:17:13.792	2026-02-13 23:17:13.792	Job "JOB TESTE" stop requested.	\N	0
1042	local:1	\N	job_stopped	\N	\N	2026-02-13 23:17:22.826	2026-02-13 23:17:22.826	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1043	local:1	\N	job_step_completed	\N	\N	2026-02-13 23:17:23.357	2026-02-13 23:17:23.357	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1044	local:1	\N	job_stopped	\N	\N	2026-02-13 23:17:23.372	2026-02-13 23:17:23.372		{"job_id":4,"reason":"cancelled"}	1
1049	local:1	\N	job_stop_requested	\N	\N	2026-02-14 15:40:06.317	2026-02-14 15:40:06.317	Job "JOB TESTE" stop requested.	\N	0
1050	local:1	\N	job_stopped	\N	\N	2026-02-14 15:40:09.85	2026-02-14 15:40:09.85	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1051	local:1	4	thumbnail_updated	\N	\N	2026-02-14 15:40:11.057	2026-02-14 15:40:11.057	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771083611055.jpg","timestamp":"2026-02-14T15:40:11.057Z"}	0
1052	local:1	\N	job_step_completed	\N	\N	2026-02-14 15:40:12.28	2026-02-14 15:40:12.28	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1053	local:1	\N	job_stopped	\N	\N	2026-02-14 15:40:12.282	2026-02-14 15:40:12.282		{"job_id":4,"reason":"cancelled"}	1
1057	local:1	3	thumbnail_updated	\N	\N	2026-02-15 12:38:16.754	2026-02-15 12:38:16.754	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771159096752.jpg","timestamp":"2026-02-15T12:38:16.754Z"}	0
1149	local:1	4	thumbnail_updated	\N	\N	2026-02-17 12:56:07.336	2026-02-17 12:56:07.336	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771332967334.jpg","timestamp":"2026-02-17T12:56:07.336Z"}	0
1150	local:1	3	thumbnail_updated	\N	\N	2026-02-17 12:56:10.168	2026-02-17 12:56:10.168	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771332970166.jpg","timestamp":"2026-02-17T12:56:10.168Z"}	0
1152	local:1	\N	job_step_started	\N	\N	2026-02-17 12:56:15.445	2026-02-17 12:56:15.445	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1153	local:1	4	thumbnail_updated	\N	\N	2026-02-17 12:56:16.573	2026-02-17 12:56:16.573	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771332976569.jpg","timestamp":"2026-02-17T12:56:16.573Z"}	0
1215	local:1	\N	job_step_started	\N	\N	2026-02-17 14:07:58.011	2026-02-17 14:07:58.011	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1216	local:1	4	thumbnail_updated	\N	\N	2026-02-17 14:07:59.18	2026-02-17 14:07:59.18	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771337279175.jpg","timestamp":"2026-02-17T14:07:59.180Z"}	0
1245	local:1	\N	job_stopped	\N	\N	2026-02-17 15:39:04.554	2026-02-17 15:39:04.554	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1246	local:1	\N	job_step_completed	\N	\N	2026-02-17 15:39:10.939	2026-02-17 15:39:10.939	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1247	local:1	\N	job_step_completed	\N	\N	2026-02-17 15:39:11.259	2026-02-17 15:39:11.259	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1248	local:1	\N	job_stopped	\N	\N	2026-02-17 15:39:11.261	2026-02-17 15:39:11.261		{"job_id":4,"reason":"cancelled"}	1
1282	local:1	\N	job_started	\N	\N	2026-02-17 16:49:17.199	2026-02-17 16:49:17.199		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"13:49","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":758,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T16:49:05.029Z","window":{"end_time":"17:00","id":758,"start_time":"13:49"}}}	1
1283	local:1	\N	job_step_started	\N	\N	2026-02-17 16:49:17.212	2026-02-17 16:49:17.212	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1301	local:1	\N	job_stop_requested	\N	\N	2026-02-17 17:12:03.614	2026-02-17 17:12:03.614	Job "JOB TESTE" stop requested.	\N	0
1302	local:1	\N	job_stopped	\N	\N	2026-02-17 17:12:05.435	2026-02-17 17:12:05.435	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1303	local:1	\N	job_step_completed	\N	\N	2026-02-17 17:12:05.611	2026-02-17 17:12:05.611	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1304	local:1	\N	job_step_completed	\N	\N	2026-02-17 17:12:06.213	2026-02-17 17:12:06.213	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1305	local:1	\N	job_stopped	\N	\N	2026-02-17 17:12:06.228	2026-02-17 17:12:06.228		{"job_id":4,"reason":"cancelled"}	1
1323	local:1	3	thumbnail_updated	\N	\N	2026-02-18 22:30:13.03	2026-02-18 22:30:13.03	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771453813027.jpg","timestamp":"2026-02-18T22:30:13.030Z"}	0
1330	local:1	\N	job_step_completed	\N	\N	2026-02-18 22:31:28.863	2026-02-18 22:31:28.863	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1331	local:1	\N	job_step_completed	\N	\N	2026-02-18 22:31:29.169	2026-02-18 22:31:29.169	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1332	local:1	\N	job_stopped	\N	\N	2026-02-18 22:31:29.17	2026-02-18 22:31:29.17		{"job_id":4,"reason":"cancelled"}	1
1342	local:1	\N	job_step_completed	\N	\N	2026-02-18 22:34:15.656	2026-02-18 22:34:15.656	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
788	local:1	\N	job_stop_requested	\N	\N	2026-02-13 10:54:28.292	2026-02-13 10:54:28.292	Job "JOB TESTE" stop requested.	\N	0
816	local:1	\N	job_started	\N	\N	2026-02-13 11:28:14.818	2026-02-13 11:28:14.818		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"08:28","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":462,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T11:28:05.009Z","window":{"end_time":"17:00","id":462,"start_time":"08:28"}}}	1
817	local:1	\N	job_step_started	\N	\N	2026-02-13 11:28:14.847	2026-02-13 11:28:14.847	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
818	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:28:16.01	2026-02-13 11:28:16.01	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770982096006.jpg","timestamp":"2026-02-13T11:28:16.010Z"}	0
819	local:1	3	thumbnail_updated	\N	\N	2026-02-13 11:28:19.14	2026-02-13 11:28:19.14	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770982099139.jpg","timestamp":"2026-02-13T11:28:19.140Z"}	0
849	local:1	\N	job_stop_requested	\N	\N	2026-02-13 12:01:16.456	2026-02-13 12:01:16.456	Job "Analise Recepcao SAP_C" stop requested.	\N	0
850	local:1	\N	job_stopped	\N	\N	2026-02-13 12:01:27.983	2026-02-13 12:01:27.983	Job "Analise Recepcao SAP_C" stopped (acknowledged by EXE).	\N	0
851	local:1	\N	job_step_completed	\N	\N	2026-02-13 12:01:28.194	2026-02-13 12:01:28.194	Step #1: Passagem RAIO X completed	{"job_id":6,"job_name":"Analise Recepcao SAP_C","reason":"job_cancel","step_id":12,"step_name":"Passagem RAIO X","step_order":1}	1
852	local:1	\N	job_stopped	\N	\N	2026-02-13 12:01:28.207	2026-02-13 12:01:28.207		{"job_id":6,"reason":"cancelled"}	1
959	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:46:18.221	2026-02-13 21:46:18.221	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771019178217.jpg","timestamp":"2026-02-13T21:46:18.221Z"}	0
999	local:1	\N	job_stop_requested	\N	\N	2026-02-13 22:13:19.554	2026-02-13 22:13:19.554	Job "JOB TESTE" stop requested.	\N	0
1000	local:1	\N	job_stopped	\N	\N	2026-02-13 22:13:25.699	2026-02-13 22:13:25.699	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1001	local:1	\N	job_step_completed	\N	\N	2026-02-13 22:13:27.016	2026-02-13 22:13:27.016	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1002	local:1	\N	job_stopped	\N	\N	2026-02-13 22:13:27.029	2026-02-13 22:13:27.029		{"job_id":4,"reason":"cancelled"}	1
1059	local:1	\N	job_step_started	\N	\N	2026-02-15 12:39:06.387	2026-02-15 12:39:06.387	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1060	local:1	4	thumbnail_updated	\N	\N	2026-02-15 12:39:07.524	2026-02-15 12:39:07.524	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771159147523.jpg","timestamp":"2026-02-15T12:39:07.524Z"}	0
1154	local:1	\N	job_stop_requested	\N	\N	2026-02-17 12:56:43.953	2026-02-17 12:56:43.953	Job "JOB TESTE" stop requested.	\N	0
1155	local:1	\N	job_stopped	\N	\N	2026-02-17 12:56:51.115	2026-02-17 12:56:51.115	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1156	local:1	\N	job_step_completed	\N	\N	2026-02-17 12:56:52.296	2026-02-17 12:56:52.296	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1157	local:1	\N	job_step_completed	\N	\N	2026-02-17 12:56:52.588	2026-02-17 12:56:52.588	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1158	local:1	\N	job_stopped	\N	\N	2026-02-17 12:56:52.603	2026-02-17 12:56:52.603		{"job_id":4,"reason":"cancelled"}	1
1219	local:1	\N	job_stop_requested	\N	\N	2026-02-17 14:08:35.405	2026-02-17 14:08:35.405	Job "JOB TESTE" stop requested.	\N	0
1220	local:1	3	thumbnail_updated	\N	\N	2026-02-17 14:08:37.967	2026-02-17 14:08:37.967	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771337317963.jpg","timestamp":"2026-02-17T14:08:37.967Z"}	0
1249	local:1	\N	job_started	\N	\N	2026-02-17 15:58:19.355	2026-02-17 15:58:19.355		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"12:58","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":737,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T15:58:05.022Z","window":{"end_time":"17:00","id":737,"start_time":"12:58"}}}	1
1250	local:1	\N	job_step_started	\N	\N	2026-02-17 15:58:19.4	2026-02-17 15:58:19.4	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1251	local:1	4	thumbnail_updated	\N	\N	2026-02-17 15:58:20.903	2026-02-17 15:58:20.903	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771343900900.jpg","timestamp":"2026-02-17T15:58:20.903Z"}	0
1252	local:1	3	thumbnail_updated	\N	\N	2026-02-17 15:58:23.562	2026-02-17 15:58:23.562	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771343903560.jpg","timestamp":"2026-02-17T15:58:23.562Z"}	0
1254	local:1	\N	job_step_started	\N	\N	2026-02-17 15:58:35.373	2026-02-17 15:58:35.373	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1255	local:1	4	thumbnail_updated	\N	\N	2026-02-17 15:58:36.498	2026-02-17 15:58:36.498	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771343916497.jpg","timestamp":"2026-02-17T15:58:36.498Z"}	0
1284	local:1	4	thumbnail_updated	\N	\N	2026-02-17 16:49:18.382	2026-02-17 16:49:18.382	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771346958380.jpg","timestamp":"2026-02-17T16:49:18.382Z"}	0
1285	local:1	3	thumbnail_updated	\N	\N	2026-02-17 16:49:21.272	2026-02-17 16:49:21.272	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771346961266.jpg","timestamp":"2026-02-17T16:49:21.272Z"}	0
1306	local:1	4	thumbnail_updated	\N	\N	2026-02-18 14:36:31.449	2026-02-18 14:36:31.449	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771425391447.jpg","timestamp":"2026-02-18T14:36:31.449Z"}	0
1308	local:1	\N	job_started	\N	\N	2026-02-18 21:40:16.038	2026-02-18 21:40:16.038		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-18","local_time":"18:40","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":773,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-18T21:40:05.054Z","window":{"end_time":"23:00","id":773,"start_time":"18:40"}}}	1
1309	local:1	\N	job_step_started	\N	\N	2026-02-18 21:40:16.079	2026-02-18 21:40:16.079	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1310	local:1	4	thumbnail_updated	\N	\N	2026-02-18 21:40:17.585	2026-02-18 21:40:17.585	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771450817583.jpg","timestamp":"2026-02-18T21:40:17.585Z"}	0
1311	local:1	3	thumbnail_updated	\N	\N	2026-02-18 21:40:20.283	2026-02-18 21:40:20.283	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771450820281.jpg","timestamp":"2026-02-18T21:40:20.283Z"}	0
1312	local:1	\N	job_stop_requested	\N	\N	2026-02-18 21:40:29.629	2026-02-18 21:40:29.629	Job "JOB TESTE" stop requested.	\N	0
1313	local:1	\N	job_stopped	\N	\N	2026-02-18 21:40:31.052	2026-02-18 21:40:31.052	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
789	local:1	\N	job_stopped	\N	\N	2026-02-13 10:54:38.277	2026-02-13 10:54:38.277	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
790	local:1	\N	job_step_completed	\N	\N	2026-02-13 10:54:38.8	2026-02-13 10:54:38.8	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
791	local:1	\N	job_stopped	\N	\N	2026-02-13 10:54:38.817	2026-02-13 10:54:38.817		{"job_id":4,"reason":"cancelled"}	1
820	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:29:16.05	2026-02-13 11:29:16.05	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770982156046.jpg","timestamp":"2026-02-13T11:29:16.050Z"}	0
821	local:1	3	thumbnail_updated	\N	\N	2026-02-13 11:29:19.157	2026-02-13 11:29:19.157	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770982159155.jpg","timestamp":"2026-02-13T11:29:19.157Z"}	0
853	local:1	\N	job_started	\N	\N	2026-02-13 12:05:13.72	2026-02-13 12:05:13.72		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"09:05","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":483,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T12:05:05.026Z","window":{"end_time":"17:00","id":483,"start_time":"09:05"}}}	1
854	local:1	\N	job_step_started	\N	\N	2026-02-13 12:05:13.73	2026-02-13 12:05:13.73	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
855	local:1	4	thumbnail_updated	\N	\N	2026-02-13 12:05:14.594	2026-02-13 12:05:14.594	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770984314591.jpg","timestamp":"2026-02-13T12:05:14.594Z"}	0
856	local:1	3	thumbnail_updated	\N	\N	2026-02-13 12:05:17.913	2026-02-13 12:05:17.913	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770984317910.jpg","timestamp":"2026-02-13T12:05:17.913Z"}	0
898	local:1	4	thumbnail_updated	\N	\N	2026-02-13 16:06:03.483	2026-02-13 16:06:03.483	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770998763480.jpg","timestamp":"2026-02-13T16:06:03.483Z"}	0
899	local:1	\N	job_stop_requested	\N	\N	2026-02-13 16:06:14.44	2026-02-13 16:06:14.44	Job "JOB TESTE" stop requested.	\N	0
900	local:1	\N	job_stopped	\N	\N	2026-02-13 16:06:26.023	2026-02-13 16:06:26.023	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
902	local:1	\N	job_step_completed	\N	\N	2026-02-13 16:06:30.335	2026-02-13 16:06:30.335	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
903	local:1	\N	job_step_completed	\N	\N	2026-02-13 16:06:30.661	2026-02-13 16:06:30.661	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
904	local:1	\N	job_stopped	\N	\N	2026-02-13 16:06:30.662	2026-02-13 16:06:30.662		{"job_id":4,"reason":"cancelled"}	1
960	local:1	\N	job_stop_requested	\N	\N	2026-02-13 21:46:35.511	2026-02-13 21:46:35.511	Job "JOB TESTE" stop requested.	\N	0
961	local:1	\N	job_stopped	\N	\N	2026-02-13 21:46:47.108	2026-02-13 21:46:47.108	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
962	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:46:48.233	2026-02-13 21:46:48.233	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
963	local:1	\N	job_stopped	\N	\N	2026-02-13 21:46:48.262	2026-02-13 21:46:48.262		{"job_id":4,"reason":"cancelled"}	1
1003	local:1	\N	job_started	\N	\N	2026-02-13 22:57:06.231	2026-02-13 22:57:06.231		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"19:57","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":574,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T22:57:05.047Z","window":{"end_time":"23:00","id":574,"start_time":"19:57"}}}	1
1004	local:1	\N	job_step_started	\N	\N	2026-02-13 22:57:06.241	2026-02-13 22:57:06.241	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1005	local:1	4	thumbnail_updated	\N	\N	2026-02-13 22:57:07.788	2026-02-13 22:57:07.788	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771023427785.jpg","timestamp":"2026-02-13T22:57:07.788Z"}	0
1006	local:1	3	thumbnail_updated	\N	\N	2026-02-13 22:57:10.365	2026-02-13 22:57:10.365	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771023430360.jpg","timestamp":"2026-02-13T22:57:10.365Z"}	0
1061	local:1	3	thumbnail_updated	\N	\N	2026-02-15 12:39:17.031	2026-02-15 12:39:17.031	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771159157028.jpg","timestamp":"2026-02-15T12:39:17.031Z"}	0
1062	local:1	\N	job_stop_requested	\N	\N	2026-02-15 12:39:24.255	2026-02-15 12:39:24.255	Job "JOB TESTE" stop requested.	\N	0
1063	local:1	\N	job_stopped	\N	\N	2026-02-15 12:39:27.699	2026-02-15 12:39:27.699	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1064	local:1	\N	job_step_completed	\N	\N	2026-02-15 12:39:32.545	2026-02-15 12:39:32.545	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1065	local:1	\N	job_step_completed	\N	\N	2026-02-15 12:39:32.888	2026-02-15 12:39:32.888	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1066	local:1	\N	job_stopped	\N	\N	2026-02-15 12:39:32.889	2026-02-15 12:39:32.889		{"job_id":4,"reason":"cancelled"}	1
1159	local:1	\N	job_started	\N	\N	2026-02-17 13:44:12.632	2026-02-17 13:44:12.632		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"10:44","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":676,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T13:44:05.031Z","window":{"end_time":"17:00","id":676,"start_time":"10:44"}}}	1
1160	local:1	\N	job_step_started	\N	\N	2026-02-17 13:44:12.647	2026-02-17 13:44:12.647	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1161	local:1	4	thumbnail_updated	\N	\N	2026-02-17 13:44:14.251	2026-02-17 13:44:14.251	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771335854249.jpg","timestamp":"2026-02-17T13:44:14.251Z"}	0
1162	local:1	3	thumbnail_updated	\N	\N	2026-02-17 13:44:16.808	2026-02-17 13:44:16.808	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771335856807.jpg","timestamp":"2026-02-17T13:44:16.808Z"}	0
1221	local:1	\N	job_stopped	\N	\N	2026-02-17 14:08:48.304	2026-02-17 14:08:48.304	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1222	local:1	\N	job_step_completed	\N	\N	2026-02-17 14:08:49.223	2026-02-17 14:08:49.223	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1223	local:1	\N	job_step_completed	\N	\N	2026-02-17 14:08:49.503	2026-02-17 14:08:49.503	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1224	local:1	\N	job_stopped	\N	\N	2026-02-17 14:08:49.505	2026-02-17 14:08:49.505		{"job_id":4,"reason":"cancelled"}	1
1256	local:1	\N	job_stop_requested	\N	\N	2026-02-17 15:58:47.391	2026-02-17 15:58:47.391	Job "JOB TESTE" stop requested.	\N	0
1257	local:1	\N	job_stopped	\N	\N	2026-02-17 15:58:49.371	2026-02-17 15:58:49.371	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
792	local:1	\N	job_started	\N	\N	2026-02-13 10:57:09.127	2026-02-13 10:57:09.127		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"07:57","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":448,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T10:57:05.032Z","window":{"end_time":"17:00","id":448,"start_time":"07:57"}}}	1
793	local:1	\N	job_step_started	\N	\N	2026-02-13 10:57:09.191	2026-02-13 10:57:09.191	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
794	local:1	3	camera_connection_failed	\N	\N	2026-02-13 10:57:09.62	2026-02-13 10:57:09.62	Failed to connect to camera.	{"error":"avformat_open_input: Server returned 401 Unauthorized (authorization failed)","rtsp_url":"rtsp://admin:Mibo2025*@192.168.0.106:554/cam/realmonitor?channel=1&subtype=0|rtsp://admin:Mibo2025*@192.168.0.106:554/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif|rtsp://192.168.0.106/user=admin&password=Mibo2025*&channel=1&stream=0.sdp?"}	1
795	local:1	4	thumbnail_updated	\N	\N	2026-02-13 10:57:10.399	2026-02-13 10:57:10.399	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770980230395.jpg","timestamp":"2026-02-13T10:57:10.399Z"}	0
822	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:30:16.082	2026-02-13 11:30:16.082	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770982216079.jpg","timestamp":"2026-02-13T11:30:16.082Z"}	0
857	local:1	\N	job_stop_requested	\N	\N	2026-02-13 12:06:00.305	2026-02-13 12:06:00.305	Job "JOB TESTE" stop requested.	\N	0
858	local:1	\N	job_stopped	\N	\N	2026-02-13 12:06:13.836	2026-02-13 12:06:13.836	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
859	local:1	4	thumbnail_updated	\N	\N	2026-02-13 12:06:14.631	2026-02-13 12:06:14.631	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770984374630.jpg","timestamp":"2026-02-13T12:06:14.631Z"}	0
860	local:1	\N	job_step_completed	\N	\N	2026-02-13 12:06:14.944	2026-02-13 12:06:14.944	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
861	local:1	\N	job_stopped	\N	\N	2026-02-13 12:06:14.946	2026-02-13 12:06:14.946		{"job_id":4,"reason":"cancelled"}	1
964	local:1	\N	job_started	\N	\N	2026-02-13 21:55:17.721	2026-02-13 21:55:17.721		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"18:55","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":553,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T21:55:05.026Z","window":{"end_time":"23:00","id":553,"start_time":"18:55"}}}	1
965	local:1	\N	job_step_started	\N	\N	2026-02-13 21:55:17.757	2026-02-13 21:55:17.757	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
966	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:55:19.211	2026-02-13 21:55:19.211	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771019719209.jpg","timestamp":"2026-02-13T21:55:19.211Z"}	0
967	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:55:21.909	2026-02-13 21:55:21.909	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771019721906.jpg","timestamp":"2026-02-13T21:55:21.909Z"}	0
1007	local:1	4	thumbnail_updated	\N	\N	2026-02-13 22:58:07.824	2026-02-13 22:58:07.824	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771023487822.jpg","timestamp":"2026-02-13T22:58:07.824Z"}	0
1008	local:1	3	thumbnail_updated	\N	\N	2026-02-13 22:58:12.256	2026-02-13 22:58:12.256	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771023492249.jpg","timestamp":"2026-02-13T22:58:12.256Z"}	0
1067	local:1	\N	job_started	\N	\N	2026-02-15 13:03:18.579	2026-02-15 13:03:18.579		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-15","local_time":"10:03","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":618,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-15T13:03:05.026Z","window":{"end_time":"23:00","id":618,"start_time":"10:03"}}}	1
1068	local:1	\N	job_step_started	\N	\N	2026-02-15 13:03:18.594	2026-02-15 13:03:18.594	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1069	local:1	4	thumbnail_updated	\N	\N	2026-02-15 13:03:20.09	2026-02-15 13:03:20.09	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771160600088.jpg","timestamp":"2026-02-15T13:03:20.090Z"}	0
1070	local:1	3	thumbnail_updated	\N	\N	2026-02-15 13:03:22.811	2026-02-15 13:03:22.811	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771160602810.jpg","timestamp":"2026-02-15T13:03:22.811Z"}	0
1087	local:1	\N	job_started	\N	\N	2026-02-16 15:25:08.436	2026-02-16 15:25:08.436		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-16","local_time":"12:25","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":633,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-16T15:25:05.052Z","window":{"end_time":"23:00","id":633,"start_time":"12:25"}}}	1
1088	local:1	\N	job_step_started	\N	\N	2026-02-16 15:25:08.465	2026-02-16 15:25:08.465	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1089	local:1	4	thumbnail_updated	\N	\N	2026-02-16 15:25:09.953	2026-02-16 15:25:09.953	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771255509951.jpg","timestamp":"2026-02-16T15:25:09.953Z"}	0
1090	local:1	3	thumbnail_updated	\N	\N	2026-02-16 15:25:12.643	2026-02-16 15:25:12.643	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771255512642.jpg","timestamp":"2026-02-16T15:25:12.643Z"}	0
1109	local:1	\N	job_started	\N	\N	2026-02-17 12:43:12.263	2026-02-17 12:43:12.263		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"09:43","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":648,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T12:43:05.027Z","window":{"end_time":"17:00","id":648,"start_time":"09:43"}}}	1
1110	local:1	\N	job_step_started	\N	\N	2026-02-17 12:43:12.282	2026-02-17 12:43:12.282	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1111	local:1	4	thumbnail_updated	\N	\N	2026-02-17 12:43:13.846	2026-02-17 12:43:13.846	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771332193844.jpg","timestamp":"2026-02-17T12:43:13.846Z"}	0
1112	local:1	3	thumbnail_updated	\N	\N	2026-02-17 12:43:16.551	2026-02-17 12:43:16.551	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771332196549.jpg","timestamp":"2026-02-17T12:43:16.551Z"}	0
1163	local:1	4	thumbnail_updated	\N	\N	2026-02-17 13:45:14.25	2026-02-17 13:45:14.25	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771335914249.jpg","timestamp":"2026-02-17T13:45:14.250Z"}	0
1258	local:1	\N	job_step_completed	\N	\N	2026-02-17 15:58:49.539	2026-02-17 15:58:49.539	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1340	local:1	\N	job_stop_requested	\N	\N	2026-02-18 22:34:13.116	2026-02-18 22:34:13.116	Job "JOB TESTE" stop requested.	\N	0
823	local:1	\N	job_stop_requested	\N	\N	2026-02-13 11:30:47.633	2026-02-13 11:30:47.633	Job "JOB TESTE" stop requested.	\N	0
862	local:1	\N	job_started	\N	\N	2026-02-13 12:40:10.656	2026-02-13 12:40:10.656		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"09:40","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":490,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T12:40:05.011Z","window":{"end_time":"17:00","id":490,"start_time":"09:40"}}}	1
863	local:1	\N	job_step_started	\N	\N	2026-02-13 12:40:10.7	2026-02-13 12:40:10.7	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
864	local:1	4	thumbnail_updated	\N	\N	2026-02-13 12:40:11.914	2026-02-13 12:40:11.914	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770986411912.jpg","timestamp":"2026-02-13T12:40:11.914Z"}	0
865	local:1	3	thumbnail_updated	\N	\N	2026-02-13 12:40:14.923	2026-02-13 12:40:14.923	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770986414922.jpg","timestamp":"2026-02-13T12:40:14.923Z"}	0
905	local:1	\N	job_started	\N	\N	2026-02-13 21:14:20.199	2026-02-13 21:14:20.199		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"18:14","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":518,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T21:14:05.073Z","window":{"end_time":"23:00","id":518,"start_time":"18:14"}}}	1
906	local:1	\N	job_step_started	\N	\N	2026-02-13 21:14:20.26	2026-02-13 21:14:20.26	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
907	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:14:21.801	2026-02-13 21:14:21.801	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771017261799.jpg","timestamp":"2026-02-13T21:14:21.801Z"}	0
908	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:14:24.408	2026-02-13 21:14:24.408	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771017264404.jpg","timestamp":"2026-02-13T21:14:24.408Z"}	0
919	local:1	\N	job_started	\N	\N	2026-02-13 21:28:13.415	2026-02-13 21:28:13.415		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"18:28","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":525,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T21:28:05.042Z","window":{"end_time":"23:00","id":525,"start_time":"18:28"}}}	1
920	local:1	\N	job_step_started	\N	\N	2026-02-13 21:28:13.447	2026-02-13 21:28:13.447	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
921	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:28:14.806	2026-02-13 21:28:14.806	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771018094805.jpg","timestamp":"2026-02-13T21:28:14.806Z"}	0
922	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:28:17.75	2026-02-13 21:28:17.75	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771018097748.jpg","timestamp":"2026-02-13T21:28:17.750Z"}	0
969	local:1	\N	job_step_started	\N	\N	2026-02-13 21:55:39.367	2026-02-13 21:55:39.367	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
970	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:55:40.503	2026-02-13 21:55:40.503	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771019740500.jpg","timestamp":"2026-02-13T21:55:40.503Z"}	0
1010	local:1	\N	job_step_started	\N	\N	2026-02-13 22:58:23.805	2026-02-13 22:58:23.805	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1011	local:1	\N	job_stop_requested	\N	\N	2026-02-13 22:58:24.513	2026-02-13 22:58:24.513	Job "JOB TESTE" stop requested.	\N	0
1072	local:1	\N	job_step_started	\N	\N	2026-02-15 13:03:39.572	2026-02-15 13:03:39.572	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1073	local:1	4	thumbnail_updated	\N	\N	2026-02-15 13:03:40.697	2026-02-15 13:03:40.697	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771160620692.jpg","timestamp":"2026-02-15T13:03:40.697Z"}	0
1091	local:1	\N	job_stop_requested	\N	\N	2026-02-16 15:25:44.855	2026-02-16 15:25:44.855	Job "JOB TESTE" stop requested.	\N	0
1092	local:1	\N	job_stopped	\N	\N	2026-02-16 15:25:53.483	2026-02-16 15:25:53.483	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1093	local:1	\N	job_step_completed	\N	\N	2026-02-16 15:26:00.771	2026-02-16 15:26:00.771	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1094	local:1	\N	job_stopped	\N	\N	2026-02-16 15:26:00.772	2026-02-16 15:26:00.772		{"job_id":4,"reason":"cancelled"}	1
1114	local:1	\N	job_step_started	\N	\N	2026-02-17 12:44:00.95	2026-02-17 12:44:00.95	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1115	local:1	4	thumbnail_updated	\N	\N	2026-02-17 12:44:02.069	2026-02-17 12:44:02.069	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771332242068.jpg","timestamp":"2026-02-17T12:44:02.069Z"}	0
1116	local:1	3	thumbnail_updated	\N	\N	2026-02-17 12:44:17.131	2026-02-17 12:44:17.131	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771332257129.jpg","timestamp":"2026-02-17T12:44:17.131Z"}	0
1164	local:1	3	thumbnail_updated	\N	\N	2026-02-17 13:45:52.919	2026-02-17 13:45:52.919	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771335952915.jpg","timestamp":"2026-02-17T13:45:52.919Z"}	0
1166	local:1	\N	job_step_started	\N	\N	2026-02-17 13:45:59.48	2026-02-17 13:45:59.48	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1167	local:1	4	thumbnail_updated	\N	\N	2026-02-17 13:46:00.628	2026-02-17 13:46:00.628	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771335960627.jpg","timestamp":"2026-02-17T13:46:00.628Z"}	0
1225	local:1	\N	job_started	\N	\N	2026-02-17 15:35:14.791	2026-02-17 15:35:14.791		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"12:35","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":723,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T15:35:05.034Z","window":{"end_time":"17:00","id":723,"start_time":"12:35"}}}	1
1226	local:1	\N	job_step_started	\N	\N	2026-02-17 15:35:14.847	2026-02-17 15:35:14.847	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1259	local:1	\N	job_step_completed	\N	\N	2026-02-17 15:58:49.866	2026-02-17 15:58:49.866	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1260	local:1	\N	job_stopped	\N	\N	2026-02-17 15:58:49.868	2026-02-17 15:58:49.868		{"job_id":4,"reason":"cancelled"}	1
1341	local:1	\N	job_stopped	\N	\N	2026-02-18 22:34:14.505	2026-02-18 22:34:14.505	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
797	local:1	4	thumbnail_updated	\N	\N	2026-02-13 10:58:10.432	2026-02-13 10:58:10.432	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770980290428.jpg","timestamp":"2026-02-13T10:58:10.432Z"}	0
824	local:1	\N	job_stopped	\N	\N	2026-02-13 11:31:00.539	2026-02-13 11:31:00.539	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
825	local:1	\N	job_step_completed	\N	\N	2026-02-13 11:31:01.646	2026-02-13 11:31:01.646	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
826	local:1	\N	job_stopped	\N	\N	2026-02-13 11:31:01.648	2026-02-13 11:31:01.648		{"job_id":4,"reason":"cancelled"}	1
867	local:1	\N	job_stop_requested	\N	\N	2026-02-13 12:41:07.584	2026-02-13 12:41:07.584	Job "JOB TESTE" stop requested.	\N	0
868	local:1	\N	job_stopped	\N	\N	2026-02-13 12:41:10.692	2026-02-13 12:41:10.692	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
869	local:1	\N	job_step_completed	\N	\N	2026-02-13 12:41:11.598	2026-02-13 12:41:11.598	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
870	local:1	\N	job_stopped	\N	\N	2026-02-13 12:41:11.599	2026-02-13 12:41:11.599		{"job_id":4,"reason":"cancelled"}	1
910	local:1	\N	job_step_started	\N	\N	2026-02-13 21:14:41.872	2026-02-13 21:14:41.872	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
911	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:14:43.016	2026-02-13 21:14:43.016	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771017283015.jpg","timestamp":"2026-02-13T21:14:43.016Z"}	0
924	local:1	\N	job_step_started	\N	\N	2026-02-13 21:28:37.277	2026-02-13 21:28:37.277	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
925	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:28:38.119	2026-02-13 21:28:38.119	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771018118116.jpg","timestamp":"2026-02-13T21:28:38.119Z"}	0
926	local:1	\N	job_stop_requested	\N	\N	2026-02-13 21:28:46.097	2026-02-13 21:28:46.097	Job "JOB TESTE" stop requested.	\N	0
971	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:56:22.652	2026-02-13 21:56:22.652	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771019782646.jpg","timestamp":"2026-02-13T21:56:22.652Z"}	0
1012	local:1	4	thumbnail_updated	\N	\N	2026-02-13 22:58:24.984	2026-02-13 22:58:24.984	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771023504983.jpg","timestamp":"2026-02-13T22:58:24.984Z"}	0
1074	local:1	\N	job_stop_requested	\N	\N	2026-02-15 13:03:49.445	2026-02-15 13:03:49.445	Job "JOB TESTE" stop requested.	\N	0
1075	local:1	\N	job_stopped	\N	\N	2026-02-15 13:04:03.622	2026-02-15 13:04:03.622	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1076	local:1	\N	job_step_completed	\N	\N	2026-02-15 13:04:06.126	2026-02-15 13:04:06.126	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1077	local:1	\N	job_step_completed	\N	\N	2026-02-15 13:04:06.463	2026-02-15 13:04:06.463	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1078	local:1	\N	job_stopped	\N	\N	2026-02-15 13:04:06.496	2026-02-15 13:04:06.496		{"job_id":4,"reason":"cancelled"}	1
1095	local:1	\N	job_started	\N	\N	2026-02-16 17:18:17.821	2026-02-16 17:18:17.821		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-16","local_time":"14:18","schedule_day":{"day_name":"Monday","day_of_month":null,"day_of_week":1,"id":640,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-16T17:18:05.035Z","window":{"end_time":"23:00","id":640,"start_time":"14:18"}}}	1
1096	local:1	\N	job_step_started	\N	\N	2026-02-16 17:18:17.867	2026-02-16 17:18:17.867	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1097	local:1	4	thumbnail_updated	\N	\N	2026-02-16 17:18:19.037	2026-02-16 17:18:19.037	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771262299034.jpg","timestamp":"2026-02-16T17:18:19.037Z"}	0
1098	local:1	3	thumbnail_updated	\N	\N	2026-02-16 17:18:21.983	2026-02-16 17:18:21.983	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771262301978.jpg","timestamp":"2026-02-16T17:18:21.983Z"}	0
1117	local:1	\N	job_stop_requested	\N	\N	2026-02-17 12:44:34.969	2026-02-17 12:44:34.969	Job "JOB TESTE" stop requested.	\N	0
1118	local:1	\N	job_stopped	\N	\N	2026-02-17 12:44:42.507	2026-02-17 12:44:42.507	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1119	local:1	\N	job_step_completed	\N	\N	2026-02-17 12:44:43.038	2026-02-17 12:44:43.038	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1120	local:1	\N	job_step_completed	\N	\N	2026-02-17 12:44:43.31	2026-02-17 12:44:43.31	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1121	local:1	\N	job_stopped	\N	\N	2026-02-17 12:44:43.311	2026-02-17 12:44:43.311		{"job_id":4,"reason":"cancelled"}	1
1168	local:1	\N	job_stop_requested	\N	\N	2026-02-17 13:46:56.606	2026-02-17 13:46:56.606	Job "JOB TESTE" stop requested.	\N	0
1227	local:1	4	thumbnail_updated	\N	\N	2026-02-17 15:35:16.238	2026-02-17 15:35:16.238	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771342516236.jpg","timestamp":"2026-02-17T15:35:16.238Z"}	0
1228	local:1	3	thumbnail_updated	\N	\N	2026-02-17 15:35:19.047	2026-02-17 15:35:19.047	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771342519040.jpg","timestamp":"2026-02-17T15:35:19.047Z"}	0
1261	local:1	\N	job_started	\N	\N	2026-02-17 16:40:10.452	2026-02-17 16:40:10.452		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"13:40","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":744,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T16:40:05.039Z","window":{"end_time":"17:00","id":744,"start_time":"13:40"}}}	1
1262	local:1	\N	job_step_started	\N	\N	2026-02-17 16:40:10.48	2026-02-17 16:40:10.48	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1263	local:1	4	thumbnail_updated	\N	\N	2026-02-17 16:40:11.696	2026-02-17 16:40:11.696	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771346411695.jpg","timestamp":"2026-02-17T16:40:11.696Z"}	0
1264	local:1	3	thumbnail_updated	\N	\N	2026-02-17 16:40:14.663	2026-02-17 16:40:14.663	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771346414657.jpg","timestamp":"2026-02-17T16:40:14.663Z"}	0
1307	local:1	4	thumbnail_updated	\N	\N	2026-02-18 14:37:31.468	2026-02-18 14:37:31.468	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771425451464.jpg","timestamp":"2026-02-18T14:37:31.468Z"}	0
1314	local:1	\N	job_step_completed	\N	\N	2026-02-18 21:40:31.713	2026-02-18 21:40:31.713	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1315	local:1	\N	job_stopped	\N	\N	2026-02-18 21:40:31.715	2026-02-18 21:40:31.715		{"job_id":4,"reason":"cancelled"}	1
1355	local:1	\N	job_stop_requested	\N	\N	2026-02-18 22:40:38.907	2026-02-18 22:40:38.907	Job "JOB TESTE" stop requested.	\N	0
798	local:1	4	thumbnail_updated	\N	\N	2026-02-13 10:59:10.479	2026-02-13 10:59:10.479	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770980350474.jpg","timestamp":"2026-02-13T10:59:10.479Z"}	0
827	local:1	\N	job_started	\N	\N	2026-02-13 11:56:05.905	2026-02-13 11:56:05.905		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"08:56","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":469,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T11:56:05.012Z","window":{"end_time":"17:00","id":469,"start_time":"08:56"}}}	1
828	local:1	\N	job_step_started	\N	\N	2026-02-13 11:56:05.928	2026-02-13 11:56:05.928	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
829	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:56:07.19	2026-02-13 11:56:07.19	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770983767186.jpg","timestamp":"2026-02-13T11:56:07.190Z"}	0
830	local:1	3	thumbnail_updated	\N	\N	2026-02-13 11:56:10.065	2026-02-13 11:56:10.065	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770983770064.jpg","timestamp":"2026-02-13T11:56:10.065Z"}	0
871	local:1	\N	job_started	\N	\N	2026-02-13 15:05:11.466	2026-02-13 15:05:11.466		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"12:05","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":497,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T15:05:05.016Z","window":{"end_time":"17:00","id":497,"start_time":"12:05"}}}	1
872	local:1	\N	job_step_started	\N	\N	2026-02-13 15:05:11.507	2026-02-13 15:05:11.507	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
912	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:15:25.213	2026-02-13 21:15:25.213	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771017325209.jpg","timestamp":"2026-02-13T21:15:25.213Z"}	0
927	local:1	\N	job_stopped	\N	\N	2026-02-13 21:28:58.502	2026-02-13 21:28:58.502	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
928	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:29:04.934	2026-02-13 21:29:04.934	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
929	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:29:05.248	2026-02-13 21:29:05.248	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
930	local:1	\N	job_stopped	\N	\N	2026-02-13 21:29:05.25	2026-02-13 21:29:05.25		{"job_id":4,"reason":"cancelled"}	1
972	local:1	\N	job_stop_requested	\N	\N	2026-02-13 21:56:37.511	2026-02-13 21:56:37.511	Job "JOB TESTE" stop requested.	\N	0
973	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:56:40.541	2026-02-13 21:56:40.541	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771019800538.jpg","timestamp":"2026-02-13T21:56:40.541Z"}	0
975	local:1	\N	job_stopped	\N	\N	2026-02-13 21:56:47.91	2026-02-13 21:56:47.91	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1013	local:1	\N	job_stopped	\N	\N	2026-02-13 22:58:36.54	2026-02-13 22:58:36.54	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1014	local:1	\N	job_step_completed	\N	\N	2026-02-13 22:58:37.386	2026-02-13 22:58:37.386	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1015	local:1	\N	job_step_completed	\N	\N	2026-02-13 22:58:37.685	2026-02-13 22:58:37.685	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1016	local:1	\N	job_stopped	\N	\N	2026-02-13 22:58:37.686	2026-02-13 22:58:37.686		{"job_id":4,"reason":"cancelled"}	1
1079	local:1	\N	job_started	\N	\N	2026-02-15 13:10:09.956	2026-02-15 13:10:09.956		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-15","local_time":"10:10","schedule_day":{"day_name":"Sunday","day_of_month":null,"day_of_week":0,"id":625,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-15T13:10:05.055Z","window":{"end_time":"23:00","id":625,"start_time":"10:10"}}}	1
1080	local:1	\N	job_step_started	\N	\N	2026-02-15 13:10:09.983	2026-02-15 13:10:09.983	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1081	local:1	4	thumbnail_updated	\N	\N	2026-02-15 13:10:11.483	2026-02-15 13:10:11.483	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771161011479.jpg","timestamp":"2026-02-15T13:10:11.483Z"}	0
1082	local:1	3	thumbnail_updated	\N	\N	2026-02-15 13:10:14.17	2026-02-15 13:10:14.17	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771161014163.jpg","timestamp":"2026-02-15T13:10:14.170Z"}	0
1099	local:1	4	thumbnail_updated	\N	\N	2026-02-16 17:19:19.067	2026-02-16 17:19:19.067	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771262359062.jpg","timestamp":"2026-02-16T17:19:19.067Z"}	0
1100	local:1	3	thumbnail_updated	\N	\N	2026-02-16 17:19:22.526	2026-02-16 17:19:22.526	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771262362524.jpg","timestamp":"2026-02-16T17:19:22.526Z"}	0
1101	local:1	\N	job_alert_triggered	\N	\N	2026-02-16 17:19:28.089	2026-02-16 17:19:28.089		{"agent_id":-1,"agent_key":"person finder","alert_condition_text":"se achar qualquer pessoa","answer":"Uma pessoa foi detectada na imagem, sentada em frente a um computador e segurando uma pequena xícara.","camera_id":3,"camera_name":"mibo","channel":"none","clip_path":"","job_id":4,"job_name":"JOB TESTE","message_template":"","priority_level":"","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","rule_id":null,"step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1102	local:1	\N	job_step_started	\N	\N	2026-02-16 17:19:28.433	2026-02-16 17:19:28.433	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1103	local:1	4	thumbnail_updated	\N	\N	2026-02-16 17:19:29.565	2026-02-16 17:19:29.565	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771262369563.jpg","timestamp":"2026-02-16T17:19:29.565Z"}	0
1122	local:1	\N	job_started	\N	\N	2026-02-17 12:48:13.686	2026-02-17 12:48:13.686		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"09:48","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":655,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T12:48:05.017Z","window":{"end_time":"17:00","id":655,"start_time":"09:48"}}}	1
1123	local:1	\N	job_step_started	\N	\N	2026-02-17 12:48:13.693	2026-02-17 12:48:13.693	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1124	local:1	4	thumbnail_updated	\N	\N	2026-02-17 12:48:14.905	2026-02-17 12:48:14.905	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771332494902.jpg","timestamp":"2026-02-17T12:48:14.905Z"}	0
1125	local:1	3	thumbnail_updated	\N	\N	2026-02-17 12:48:17.942	2026-02-17 12:48:17.942	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771332497936.jpg","timestamp":"2026-02-17T12:48:17.942Z"}	0
799	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:00:10.512	2026-02-13 11:00:10.512	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770980410508.jpg","timestamp":"2026-02-13T11:00:10.512Z"}	0
831	local:1	\N	job_stop_requested	\N	\N	2026-02-13 11:56:56.103	2026-02-13 11:56:56.103	Job "JOB TESTE" stop requested.	\N	0
873	local:1	4	thumbnail_updated	\N	\N	2026-02-13 15:05:12.902	2026-02-13 15:05:12.902	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770995112899.jpg","timestamp":"2026-02-13T15:05:12.902Z"}	0
874	local:1	3	thumbnail_updated	\N	\N	2026-02-13 15:05:15.562	2026-02-13 15:05:15.562	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770995115560.jpg","timestamp":"2026-02-13T15:05:15.562Z"}	0
913	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:15:43.066	2026-02-13 21:15:43.066	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771017343065.jpg","timestamp":"2026-02-13T21:15:43.066Z"}	0
914	local:1	\N	job_stop_requested	\N	\N	2026-02-13 21:16:00.387	2026-02-13 21:16:00.387	Job "JOB TESTE" stop requested.	\N	0
915	local:1	\N	job_stopped	\N	\N	2026-02-13 21:16:05.38	2026-02-13 21:16:05.38	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
916	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:16:10.664	2026-02-13 21:16:10.664	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
931	local:1	\N	job_started	\N	\N	2026-02-13 21:32:07.393	2026-02-13 21:32:07.393		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"18:32","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":532,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T21:32:05.035Z","window":{"end_time":"23:00","id":532,"start_time":"18:32"}}}	1
932	local:1	\N	job_step_started	\N	\N	2026-02-13 21:32:07.401	2026-02-13 21:32:07.401	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
933	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:32:08.529	2026-02-13 21:32:08.529	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771018328527.jpg","timestamp":"2026-02-13T21:32:08.529Z"}	0
934	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:32:11.64	2026-02-13 21:32:11.64	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771018331638.jpg","timestamp":"2026-02-13T21:32:11.640Z"}	0
976	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:56:55.814	2026-02-13 21:56:55.814	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
977	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:56:56.102	2026-02-13 21:56:56.102	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
978	local:1	\N	job_stopped	\N	\N	2026-02-13 21:56:56.103	2026-02-13 21:56:56.103		{"job_id":4,"reason":"cancelled"}	1
1017	local:1	\N	job_started	\N	\N	2026-02-13 23:03:14.834	2026-02-13 23:03:14.834		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"20:03","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":588,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T23:03:05.015Z","window":{"end_time":"23:00","id":588,"start_time":"20:03"}}}	1
1018	local:1	\N	job_step_started	\N	\N	2026-02-13 23:03:14.894	2026-02-13 23:03:14.894	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1019	local:1	4	thumbnail_updated	\N	\N	2026-02-13 23:03:16.331	2026-02-13 23:03:16.331	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771023796329.jpg","timestamp":"2026-02-13T23:03:16.331Z"}	0
1020	local:1	3	thumbnail_updated	\N	\N	2026-02-13 23:03:19.205	2026-02-13 23:03:19.205	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771023799200.jpg","timestamp":"2026-02-13T23:03:19.205Z"}	0
1083	local:1	\N	job_stop_requested	\N	\N	2026-02-15 13:11:08.739	2026-02-15 13:11:08.739	Job "JOB TESTE" stop requested.	\N	0
1084	local:1	\N	job_stopped	\N	\N	2026-02-15 13:11:10.234	2026-02-15 13:11:10.234	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1085	local:1	\N	job_step_completed	\N	\N	2026-02-15 13:11:11.399	2026-02-15 13:11:11.399	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1086	local:1	\N	job_stopped	\N	\N	2026-02-15 13:11:11.4	2026-02-15 13:11:11.4		{"job_id":4,"reason":"cancelled"}	1
1104	local:1	\N	job_stop_requested	\N	\N	2026-02-16 17:19:51.404	2026-02-16 17:19:51.404	Job "JOB TESTE" stop requested.	\N	0
1105	local:1	\N	job_stopped	\N	\N	2026-02-16 17:20:02.974	2026-02-16 17:20:02.974	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1106	local:1	\N	job_step_completed	\N	\N	2026-02-16 17:20:06.846	2026-02-16 17:20:06.846	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1107	local:1	\N	job_step_completed	\N	\N	2026-02-16 17:20:07.132	2026-02-16 17:20:07.132	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1108	local:1	\N	job_stopped	\N	\N	2026-02-16 17:20:07.152	2026-02-16 17:20:07.152		{"job_id":4,"reason":"cancelled"}	1
1127	local:1	\N	job_step_started	\N	\N	2026-02-17 12:48:34.659	2026-02-17 12:48:34.659	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1128	local:1	4	thumbnail_updated	\N	\N	2026-02-17 12:48:35.814	2026-02-17 12:48:35.814	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771332515812.jpg","timestamp":"2026-02-17T12:48:35.814Z"}	0
1169	local:1	\N	job_stopped	\N	\N	2026-02-17 13:46:58.042	2026-02-17 13:46:58.042	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1170	local:1	\N	job_step_completed	\N	\N	2026-02-17 13:47:00.554	2026-02-17 13:47:00.554	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1171	local:1	\N	job_step_completed	\N	\N	2026-02-17 13:47:00.846	2026-02-17 13:47:00.846	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1172	local:1	\N	job_stopped	\N	\N	2026-02-17 13:47:00.847	2026-02-17 13:47:00.847		{"job_id":4,"reason":"cancelled"}	1
1230	local:1	\N	job_step_started	\N	\N	2026-02-17 15:35:48.45	2026-02-17 15:35:48.45	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1356	local:1	\N	job_stopped	\N	\N	2026-02-18 22:40:46.772	2026-02-18 22:40:46.772	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1357	local:1	\N	job_step_completed	\N	\N	2026-02-18 22:40:46.867	2026-02-18 22:40:46.867	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1358	local:1	\N	job_step_completed	\N	\N	2026-02-18 22:40:47.734	2026-02-18 22:40:47.734	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1359	local:1	\N	job_stopped	\N	\N	2026-02-18 22:40:47.736	2026-02-18 22:40:47.736		{"job_id":4,"reason":"cancelled"}	1
1374	local:1	\N	job_stopped	\N	\N	2026-02-18 23:07:22.867	2026-02-18 23:07:22.867	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
800	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:01:10.558	2026-02-13 11:01:10.558	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770980470553.jpg","timestamp":"2026-02-13T11:01:10.558Z"}	0
832	local:1	\N	job_stopped	\N	\N	2026-02-13 11:57:05.977	2026-02-13 11:57:05.977	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
833	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:57:07.203	2026-02-13 11:57:07.203	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770983827200.jpg","timestamp":"2026-02-13T11:57:07.203Z"}	0
834	local:1	\N	job_step_completed	\N	\N	2026-02-13 11:57:09.534	2026-02-13 11:57:09.534	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
835	local:1	\N	job_stopped	\N	\N	2026-02-13 11:57:09.536	2026-02-13 11:57:09.536		{"job_id":4,"reason":"cancelled"}	1
875	local:1	4	thumbnail_updated	\N	\N	2026-02-13 15:06:12.866	2026-02-13 15:06:12.866	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770995172864.jpg","timestamp":"2026-02-13T15:06:12.866Z"}	0
876	local:1	3	thumbnail_updated	\N	\N	2026-02-13 15:06:15.573	2026-02-13 15:06:15.573	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770995175569.jpg","timestamp":"2026-02-13T15:06:15.573Z"}	0
877	local:1	\N	job_stop_requested	\N	\N	2026-02-13 15:06:18.735	2026-02-13 15:06:18.735	Job "JOB TESTE" stop requested.	\N	0
878	local:1	\N	job_stopped	\N	\N	2026-02-13 15:06:26.556	2026-02-13 15:06:26.556	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
917	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:16:27.066	2026-02-13 21:16:27.066	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
918	local:1	\N	job_stopped	\N	\N	2026-02-13 21:16:27.083	2026-02-13 21:16:27.083		{"job_id":4,"reason":"cancelled"}	1
936	local:1	\N	job_step_started	\N	\N	2026-02-13 21:32:29.299	2026-02-13 21:32:29.299	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
937	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:32:30.167	2026-02-13 21:32:30.167	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771018350162.jpg","timestamp":"2026-02-13T21:32:30.167Z"}	0
979	local:1	\N	job_started	\N	\N	2026-02-13 21:59:08.883	2026-02-13 21:59:08.883		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"18:59","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":560,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T21:59:05.018Z","window":{"end_time":"23:00","id":560,"start_time":"18:59"}}}	1
980	local:1	\N	job_step_started	\N	\N	2026-02-13 21:59:08.902	2026-02-13 21:59:08.902	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
981	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:59:10.365	2026-02-13 21:59:10.365	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771019950363.jpg","timestamp":"2026-02-13T21:59:10.365Z"}	0
982	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:59:13.163	2026-02-13 21:59:13.163	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771019953161.jpg","timestamp":"2026-02-13T21:59:13.163Z"}	0
1021	local:1	4	thumbnail_updated	\N	\N	2026-02-13 23:04:16.37	2026-02-13 23:04:16.37	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771023856366.jpg","timestamp":"2026-02-13T23:04:16.370Z"}	0
1022	local:1	3	thumbnail_updated	\N	\N	2026-02-13 23:04:19.772	2026-02-13 23:04:19.772	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771023859766.jpg","timestamp":"2026-02-13T23:04:19.772Z"}	0
1023	local:1	\N	job_stop_requested	\N	\N	2026-02-13 23:04:28.511	2026-02-13 23:04:28.511	Job "JOB TESTE" stop requested.	\N	0
1024	local:1	\N	job_stopped	\N	\N	2026-02-13 23:04:29.921	2026-02-13 23:04:29.921	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1025	local:1	\N	job_step_completed	\N	\N	2026-02-13 23:04:31.535	2026-02-13 23:04:31.535	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1026	local:1	\N	job_stopped	\N	\N	2026-02-13 23:04:31.536	2026-02-13 23:04:31.536		{"job_id":4,"reason":"cancelled"}	1
1129	local:1	\N	job_stop_requested	\N	\N	2026-02-17 12:48:48.709	2026-02-17 12:48:48.709	Job "JOB TESTE" stop requested.	\N	0
1173	local:1	\N	job_started	\N	\N	2026-02-17 14:01:17.281	2026-02-17 14:01:17.281		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"11:01","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":683,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T14:01:05.017Z","window":{"end_time":"17:00","id":683,"start_time":"11:01"}}}	1
1174	local:1	\N	job_step_started	\N	\N	2026-02-17 14:01:17.317	2026-02-17 14:01:17.317	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1175	local:1	4	thumbnail_updated	\N	\N	2026-02-17 14:01:18.777	2026-02-17 14:01:18.777	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771336878775.jpg","timestamp":"2026-02-17T14:01:18.777Z"}	0
1176	local:1	3	thumbnail_updated	\N	\N	2026-02-17 14:01:21.617	2026-02-17 14:01:21.617	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771336881615.jpg","timestamp":"2026-02-17T14:01:21.617Z"}	0
1206	local:1	\N	job_stop_requested	\N	\N	2026-02-17 14:04:05.844	2026-02-17 14:04:05.844	Job "JOB TESTE" stop requested.	\N	0
1231	local:1	4	thumbnail_updated	\N	\N	2026-02-17 15:35:49.635	2026-02-17 15:35:49.635	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771342549632.jpg","timestamp":"2026-02-17T15:35:49.635Z"}	0
1266	local:1	\N	job_step_started	\N	\N	2026-02-17 16:40:45.517	2026-02-17 16:40:45.517	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
801	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:02:10.57	2026-02-13 11:02:10.57	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770980530568.jpg","timestamp":"2026-02-13T11:02:10.570Z"}	0
836	local:1	\N	job_started	\N	\N	2026-02-13 11:58:09.693	2026-02-13 11:58:09.693		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"08:58","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":476,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T11:58:05.052Z","window":{"end_time":"17:00","id":476,"start_time":"08:58"}}}	1
837	local:1	\N	job_step_started	\N	\N	2026-02-13 11:58:09.803	2026-02-13 11:58:09.803	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
838	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:58:10.985	2026-02-13 11:58:10.985	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770983890983.jpg","timestamp":"2026-02-13T11:58:10.985Z"}	0
879	local:1	4	thumbnail_updated	\N	\N	2026-02-13 15:07:12.917	2026-02-13 15:07:12.917	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770995232913.jpg","timestamp":"2026-02-13T15:07:12.917Z"}	0
938	local:1	\N	job_stop_requested	\N	\N	2026-02-13 21:32:50.641	2026-02-13 21:32:50.641	Job "JOB TESTE" stop requested.	\N	0
939	local:1	\N	job_stopped	\N	\N	2026-02-13 21:32:52.436	2026-02-13 21:32:52.436	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
940	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:32:55.673	2026-02-13 21:32:55.673	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
941	local:1	\N	job_step_completed	\N	\N	2026-02-13 21:32:55.965	2026-02-13 21:32:55.965	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
942	local:1	\N	job_stopped	\N	\N	2026-02-13 21:32:55.966	2026-02-13 21:32:55.966		{"job_id":4,"reason":"cancelled"}	1
984	local:1	\N	job_step_started	\N	\N	2026-02-13 21:59:29.279	2026-02-13 21:59:29.279	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
985	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:59:30.426	2026-02-13 21:59:30.426	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771019970422.jpg","timestamp":"2026-02-13T21:59:30.426Z"}	0
1027	local:1	\N	job_started	\N	\N	2026-02-13 23:06:15.385	2026-02-13 23:06:15.385		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"20:06","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":595,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T23:06:05.022Z","window":{"end_time":"23:00","id":595,"start_time":"20:06"}}}	1
1028	local:1	\N	job_step_started	\N	\N	2026-02-13 23:06:15.407	2026-02-13 23:06:15.407	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1029	local:1	4	thumbnail_updated	\N	\N	2026-02-13 23:06:16.894	2026-02-13 23:06:16.894	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771023976892.jpg","timestamp":"2026-02-13T23:06:16.894Z"}	0
1030	local:1	3	thumbnail_updated	\N	\N	2026-02-13 23:06:19.775	2026-02-13 23:06:19.775	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771023979771.jpg","timestamp":"2026-02-13T23:06:19.775Z"}	0
1130	local:1	\N	job_stopped	\N	\N	2026-02-17 12:48:58.726	2026-02-17 12:48:58.726	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1131	local:1	\N	job_step_completed	\N	\N	2026-02-17 12:48:59.36	2026-02-17 12:48:59.36	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1132	local:1	\N	job_step_completed	\N	\N	2026-02-17 12:48:59.984	2026-02-17 12:48:59.984	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1133	local:1	\N	job_stopped	\N	\N	2026-02-17 12:48:59.986	2026-02-17 12:48:59.986		{"job_id":4,"reason":"cancelled"}	1
1207	local:1	\N	job_stopped	\N	\N	2026-02-17 14:04:32.626	2026-02-17 14:04:32.626	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1232	local:1	\N	job_stop_requested	\N	\N	2026-02-17 15:36:01.428	2026-02-17 15:36:01.428	Job "JOB TESTE" stop requested.	\N	0
1267	local:1	4	thumbnail_updated	\N	\N	2026-02-17 16:40:46.708	2026-02-17 16:40:46.708	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771346446705.jpg","timestamp":"2026-02-17T16:40:46.708Z"}	0
1287	local:1	\N	job_step_started	\N	\N	2026-02-17 16:49:45.625	2026-02-17 16:49:45.625	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1288	local:1	4	thumbnail_updated	\N	\N	2026-02-17 16:49:46.725	2026-02-17 16:49:46.725	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771346986721.jpg","timestamp":"2026-02-17T16:49:46.725Z"}	0
1289	local:1	\N	job_stop_requested	\N	\N	2026-02-17 16:49:58.194	2026-02-17 16:49:58.194	Job "JOB TESTE" stop requested.	\N	0
1290	local:1	\N	job_stopped	\N	\N	2026-02-17 16:50:02.259	2026-02-17 16:50:02.259	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1291	local:1	\N	job_step_completed	\N	\N	2026-02-17 16:50:07.43	2026-02-17 16:50:07.43	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1292	local:1	\N	job_step_completed	\N	\N	2026-02-17 16:50:07.774	2026-02-17 16:50:07.774	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1293	local:1	\N	job_stopped	\N	\N	2026-02-17 16:50:07.791	2026-02-17 16:50:07.791		{"job_id":4,"reason":"cancelled"}	1
1316	local:1	\N	job_started	\N	\N	2026-02-18 22:28:07.26	2026-02-18 22:28:07.26		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-18","local_time":"19:28","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":780,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-18T22:28:05.020Z","window":{"end_time":"23:00","id":780,"start_time":"19:28"}}}	1
1317	local:1	\N	job_step_started	\N	\N	2026-02-18 22:28:07.273	2026-02-18 22:28:07.273	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1318	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:28:08.809	2026-02-18 22:28:08.809	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771453688806.jpg","timestamp":"2026-02-18T22:28:08.809Z"}	0
802	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:03:10.609	2026-02-13 11:03:10.609	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770980590604.jpg","timestamp":"2026-02-13T11:03:10.609Z"}	0
839	local:1	3	thumbnail_updated	\N	\N	2026-02-13 11:58:13.969	2026-02-13 11:58:13.969	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770983893966.jpg","timestamp":"2026-02-13T11:58:13.969Z"}	0
880	local:1	\N	job_started	\N	\N	2026-02-13 15:20:13.082	2026-02-13 15:20:13.082		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"12:20","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":504,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T15:20:05.032Z","window":{"end_time":"17:00","id":504,"start_time":"12:20"}}}	1
881	local:1	\N	job_step_started	\N	\N	2026-02-13 15:20:13.097	2026-02-13 15:20:13.097	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
882	local:1	4	thumbnail_updated	\N	\N	2026-02-13 15:20:14.288	2026-02-13 15:20:14.288	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770996014286.jpg","timestamp":"2026-02-13T15:20:14.288Z"}	0
883	local:1	3	thumbnail_updated	\N	\N	2026-02-13 15:20:17.028	2026-02-13 15:20:17.028	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770996017027.jpg","timestamp":"2026-02-13T15:20:17.028Z"}	0
943	local:1	\N	job_started	\N	\N	2026-02-13 21:40:11.864	2026-02-13 21:40:11.864		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-13","local_time":"18:40","schedule_day":{"day_name":"Friday","day_of_month":null,"day_of_week":5,"id":539,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-13T21:40:05.042Z","window":{"end_time":"23:00","id":539,"start_time":"18:40"}}}	1
944	local:1	\N	job_step_started	\N	\N	2026-02-13 21:40:11.889	2026-02-13 21:40:11.889	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
945	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:40:13.106	2026-02-13 21:40:13.106	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771018813104.jpg","timestamp":"2026-02-13T21:40:13.106Z"}	0
946	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:40:15.914	2026-02-13 21:40:15.914	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771018815912.jpg","timestamp":"2026-02-13T21:40:15.914Z"}	0
986	local:1	3	thumbnail_updated	\N	\N	2026-02-13 22:00:13.172	2026-02-13 22:00:13.172	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771020013168.jpg","timestamp":"2026-02-13T22:00:13.172Z"}	0
1031	local:1	4	thumbnail_updated	\N	\N	2026-02-13 23:07:16.934	2026-02-13 23:07:16.934	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771024036931.jpg","timestamp":"2026-02-13T23:07:16.934Z"}	0
1032	local:1	3	thumbnail_updated	\N	\N	2026-02-13 23:07:20.249	2026-02-13 23:07:20.249	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771024040246.jpg","timestamp":"2026-02-13T23:07:20.249Z"}	0
1134	local:1	\N	job_started	\N	\N	2026-02-17 12:51:15.366	2026-02-17 12:51:15.366		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"09:51","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":662,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T12:51:05.033Z","window":{"end_time":"17:00","id":662,"start_time":"09:51"}}}	1
1135	local:1	\N	job_step_started	\N	\N	2026-02-17 12:51:15.413	2026-02-17 12:51:15.413	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1136	local:1	4	thumbnail_updated	\N	\N	2026-02-17 12:51:16.591	2026-02-17 12:51:16.591	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771332676589.jpg","timestamp":"2026-02-17T12:51:16.591Z"}	0
1137	local:1	3	thumbnail_updated	\N	\N	2026-02-17 12:51:19.477	2026-02-17 12:51:19.477	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771332679473.jpg","timestamp":"2026-02-17T12:51:19.477Z"}	0
1139	local:1	\N	job_step_started	\N	\N	2026-02-17 12:51:26.992	2026-02-17 12:51:26.992	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1140	local:1	4	thumbnail_updated	\N	\N	2026-02-17 12:51:28.117	2026-02-17 12:51:28.117	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771332688114.jpg","timestamp":"2026-02-17T12:51:28.117Z"}	0
1208	local:1	\N	job_started	\N	\N	2026-02-17 14:06:17.923	2026-02-17 14:06:17.923		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"11:06","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":716,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T14:06:05.037Z","window":{"end_time":"17:00","id":716,"start_time":"11:06"}}}	1
1209	local:1	\N	job_step_started	\N	\N	2026-02-17 14:06:17.967	2026-02-17 14:06:17.967	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1210	local:1	4	thumbnail_updated	\N	\N	2026-02-17 14:06:19.348	2026-02-17 14:06:19.348	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771337179346.jpg","timestamp":"2026-02-17T14:06:19.348Z"}	0
1211	local:1	3	thumbnail_updated	\N	\N	2026-02-17 14:06:22.179	2026-02-17 14:06:22.179	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771337182172.jpg","timestamp":"2026-02-17T14:06:22.179Z"}	0
1233	local:1	\N	job_stopped	\N	\N	2026-02-17 15:36:14.859	2026-02-17 15:36:14.859	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1234	local:1	\N	job_step_completed	\N	\N	2026-02-17 15:36:18.966	2026-02-17 15:36:18.966	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1235	local:1	\N	job_step_completed	\N	\N	2026-02-17 15:36:19.244	2026-02-17 15:36:19.244	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1236	local:1	\N	job_stopped	\N	\N	2026-02-17 15:36:19.246	2026-02-17 15:36:19.246		{"job_id":4,"reason":"cancelled"}	1
1268	local:1	\N	job_stop_requested	\N	\N	2026-02-17 16:40:57.592	2026-02-17 16:40:57.592	Job "JOB TESTE" stop requested.	\N	0
1269	local:1	\N	job_stopped	\N	\N	2026-02-17 16:41:10.644	2026-02-17 16:41:10.644	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1270	local:1	\N	job_step_completed	\N	\N	2026-02-17 16:41:13.785	2026-02-17 16:41:13.785	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1271	local:1	\N	job_step_completed	\N	\N	2026-02-17 16:41:14.086	2026-02-17 16:41:14.086	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1272	local:1	\N	job_stopped	\N	\N	2026-02-17 16:41:14.088	2026-02-17 16:41:14.088		{"job_id":4,"reason":"cancelled"}	1
1319	local:1	3	thumbnail_updated	\N	\N	2026-02-18 22:28:11.457	2026-02-18 22:28:11.457	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771453691455.jpg","timestamp":"2026-02-18T22:28:11.457Z"}	0
1373	local:1	\N	job_stop_requested	\N	\N	2026-02-18 23:07:22.244	2026-02-18 23:07:22.244	Job "JOB TESTE" stop requested.	\N	0
803	local:1	4	thumbnail_updated	\N	\N	2026-02-13 11:04:10.639	2026-02-13 11:04:10.639	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770980650636.jpg","timestamp":"2026-02-13T11:04:10.639Z"}	0
840	local:1	\N	job_stop_requested	\N	\N	2026-02-13 11:59:00.497	2026-02-13 11:59:00.497	Job "JOB TESTE" stop requested.	\N	0
884	local:1	4	thumbnail_updated	\N	\N	2026-02-13 15:21:14.304	2026-02-13 15:21:14.304	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1770996074303.jpg","timestamp":"2026-02-13T15:21:14.304Z"}	0
885	local:1	\N	job_stop_requested	\N	\N	2026-02-13 15:21:16.141	2026-02-13 15:21:16.141	Job "JOB TESTE" stop requested.	\N	0
886	local:1	3	thumbnail_updated	\N	\N	2026-02-13 15:21:17.025	2026-02-13 15:21:17.025	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1770996077022.jpg","timestamp":"2026-02-13T15:21:17.025Z"}	0
887	local:1	\N	job_stopped	\N	\N	2026-02-13 15:21:28.147	2026-02-13 15:21:28.147	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
947	local:1	4	thumbnail_updated	\N	\N	2026-02-13 21:41:13.124	2026-02-13 21:41:13.124	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771018873115.jpg","timestamp":"2026-02-13T21:41:13.124Z"}	0
948	local:1	3	thumbnail_updated	\N	\N	2026-02-13 21:41:16.698	2026-02-13 21:41:16.698	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771018876695.jpg","timestamp":"2026-02-13T21:41:16.698Z"}	0
987	local:1	\N	job_stop_requested	\N	\N	2026-02-13 22:00:15.307	2026-02-13 22:00:15.307	Job "JOB TESTE" stop requested.	\N	0
988	local:1	\N	job_stopped	\N	\N	2026-02-13 22:00:24.008	2026-02-13 22:00:24.008	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
989	local:1	\N	job_step_completed	\N	\N	2026-02-13 22:00:25.06	2026-02-13 22:00:25.06	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
990	local:1	\N	job_step_completed	\N	\N	2026-02-13 22:00:25.359	2026-02-13 22:00:25.359	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
991	local:1	\N	job_stopped	\N	\N	2026-02-13 22:00:25.36	2026-02-13 22:00:25.36		{"job_id":4,"reason":"cancelled"}	1
1033	local:1	\N	job_stop_requested	\N	\N	2026-02-13 23:07:32.668	2026-02-13 23:07:32.668	Job "JOB TESTE" stop requested.	\N	0
1141	local:1	\N	job_stop_requested	\N	\N	2026-02-17 12:52:12.958	2026-02-17 12:52:12.958	Job "JOB TESTE" stop requested.	\N	0
1142	local:1	\N	job_stopped	\N	\N	2026-02-17 12:52:15.416	2026-02-17 12:52:15.416	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1143	local:1	3	thumbnail_updated	\N	\N	2026-02-17 12:52:19.993	2026-02-17 12:52:19.993	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771332739987.jpg","timestamp":"2026-02-17T12:52:19.993Z"}	0
1144	local:1	\N	job_step_completed	\N	\N	2026-02-17 12:52:20.207	2026-02-17 12:52:20.207	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1145	local:1	\N	job_step_completed	\N	\N	2026-02-17 12:52:20.541	2026-02-17 12:52:20.541	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1146	local:1	\N	job_stopped	\N	\N	2026-02-17 12:52:20.557	2026-02-17 12:52:20.557		{"job_id":4,"reason":"cancelled"}	1
1212	local:1	4	thumbnail_updated	\N	\N	2026-02-17 14:07:19.398	2026-02-17 14:07:19.398	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771337239393.jpg","timestamp":"2026-02-17T14:07:19.398Z"}	0
1237	local:1	\N	job_started	\N	\N	2026-02-17 15:38:19.477	2026-02-17 15:38:19.477		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"12:38","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":730,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T15:38:05.039Z","window":{"end_time":"17:00","id":730,"start_time":"12:38"}}}	1
1238	local:1	\N	job_step_started	\N	\N	2026-02-17 15:38:19.512	2026-02-17 15:38:19.512	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1239	local:1	4	thumbnail_updated	\N	\N	2026-02-17 15:38:20.745	2026-02-17 15:38:20.745	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771342700742.jpg","timestamp":"2026-02-17T15:38:20.745Z"}	0
1240	local:1	3	thumbnail_updated	\N	\N	2026-02-17 15:38:23.762	2026-02-17 15:38:23.762	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771342703757.jpg","timestamp":"2026-02-17T15:38:23.762Z"}	0
1273	local:1	\N	job_started	\N	\N	2026-02-17 16:46:14.939	2026-02-17 16:46:14.939		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"13:46","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":751,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T16:46:05.014Z","window":{"end_time":"17:00","id":751,"start_time":"13:46"}}}	1
1274	local:1	\N	job_step_started	\N	\N	2026-02-17 16:46:14.962	2026-02-17 16:46:14.962	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1275	local:1	4	thumbnail_updated	\N	\N	2026-02-17 16:46:16.176	2026-02-17 16:46:16.176	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771346776174.jpg","timestamp":"2026-02-17T16:46:16.176Z"}	0
1276	local:1	3	thumbnail_updated	\N	\N	2026-02-17 16:46:19.101	2026-02-17 16:46:19.101	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771346779099.jpg","timestamp":"2026-02-17T16:46:19.101Z"}	0
1294	local:1	\N	job_started	\N	\N	2026-02-17 17:11:05.362	2026-02-17 17:11:05.362		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-17","local_time":"14:11","schedule_day":{"day_name":"Tuesday","day_of_month":null,"day_of_week":2,"id":765,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-17T17:11:05.057Z","window":{"end_time":"17:00","id":765,"start_time":"14:11"}}}	1
1295	local:1	\N	job_step_started	\N	\N	2026-02-17 17:11:05.391	2026-02-17 17:11:05.391	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1296	local:1	4	thumbnail_updated	\N	\N	2026-02-17 17:11:06.902	2026-02-17 17:11:06.902	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771348266899.jpg","timestamp":"2026-02-17T17:11:06.902Z"}	0
1297	local:1	3	thumbnail_updated	\N	\N	2026-02-17 17:11:09.634	2026-02-17 17:11:09.634	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771348269631.jpg","timestamp":"2026-02-17T17:11:09.634Z"}	0
1320	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:29:08.818	2026-02-18 22:29:08.818	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771453748816.jpg","timestamp":"2026-02-18T22:29:08.818Z"}	0
1321	local:1	3	thumbnail_updated	\N	\N	2026-02-18 22:29:12.264	2026-02-18 22:29:12.264	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771453752261.jpg","timestamp":"2026-02-18T22:29:12.264Z"}	0
1327	local:1	3	thumbnail_updated	\N	\N	2026-02-18 22:31:13.436	2026-02-18 22:31:13.436	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771453873431.jpg","timestamp":"2026-02-18T22:31:13.436Z"}	0
1328	local:1	\N	job_stop_requested	\N	\N	2026-02-18 22:31:21.933	2026-02-18 22:31:21.933	Job "JOB TESTE" stop requested.	\N	0
1329	local:1	\N	job_stopped	\N	\N	2026-02-18 22:31:22.517	2026-02-18 22:31:22.517	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1324	local:1	\N	job_alert_triggered	\N	\N	2026-02-18 22:31:03.699	2026-02-18 22:31:03.699		{"agent_id":29,"agent_key":"person finder","alert_condition_text":"se achar qualquer pessoa","answer":"No segmento de vídeo fornecido, há a presença de uma pessoa visível a partir do timestamp 00:06 até o final do segmento.","camera_id":3,"camera_name":"mibo","channel":"none","clip_path":"C:\\\\Users\\\\nrag2\\\\AppData\\\\Local\\\\Temp\\\\jobsInferencePerceptrum\\\\Job_4\\\\step_6\\\\cam_3\\\\3_20260218_193035_20260218_193044_10s.mp4.processing","group_id":null,"group_name":null,"job_id":4,"job_name":"JOB TESTE","message_template":"","priority_level":"CRITIC","prompt_template":"procure por pessoas\\n","rule_id":null,"step_id":6,"step_name":"step teste 1 ","step_order":1,"video_key":"job_alert_media/local_1/jobs/4/steps/6/cam_3/1771453863719_dc6e815f-d8a5-4a87-acb2-a2d0f17b09eb.mp4","video_url":"http://localhost:4000/media/job_alert_media/local_1/jobs/4/steps/6/cam_3/1771453863719_dc6e815f-d8a5-4a87-acb2-a2d0f17b09eb.mp4","media_type":"video","backend_clip_path":null,"clip_url":"http://localhost:4000/media/job_alert_media/local_1/jobs/4/steps/6/cam_3/1771453863719_dc6e815f-d8a5-4a87-acb2-a2d0f17b09eb.mp4"}	1
1325	local:1	\N	job_step_started	\N	\N	2026-02-18 22:31:04.212	2026-02-18 22:31:04.212	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1326	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:31:05.403	2026-02-18 22:31:05.403	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771453865401.jpg","timestamp":"2026-02-18T22:31:05.403Z"}	0
1333	local:1	\N	job_started	\N	\N	2026-02-18 22:33:14.42	2026-02-18 22:33:14.42		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-18","local_time":"19:33","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":787,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-18T22:33:05.050Z","window":{"end_time":"23:00","id":787,"start_time":"19:33"}}}	1
1334	local:1	\N	job_step_started	\N	\N	2026-02-18 22:33:14.467	2026-02-18 22:33:14.467	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1335	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:33:15.638	2026-02-18 22:33:15.638	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771453995637.jpg","timestamp":"2026-02-18T22:33:15.638Z"}	0
1336	local:1	3	thumbnail_updated	\N	\N	2026-02-18 22:33:18.441	2026-02-18 22:33:18.441	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771453998436.jpg","timestamp":"2026-02-18T22:33:18.441Z"}	0
1337	local:1	\N	job_alert_triggered	\N	\N	2026-02-18 22:33:58.754	2026-02-18 22:33:58.754		{"agent_id":29,"agent_key":"person finder","alert_condition_text":"se achar qualquer pessoa","answer":"Há uma pessoa visível na imagem, sentada em um ambiente interno.","camera_id":3,"camera_name":"mibo","channel":"none","clip_path":"","group_id":null,"group_name":null,"job_id":4,"job_name":"JOB TESTE","message_template":"","priority_level":"CRITIC","prompt_template":"procure por pessoas\\n","rule_id":null,"step_id":6,"step_name":"step teste 1 ","step_order":1,"image_key":"job_alert_media/local_1/jobs/4/steps/6/cam_3/1771454038772_68b84258-67b4-4e0c-8b30-a08df844eda9.jpg","image_url":"http://localhost:4000/media/job_alert_media/local_1/jobs/4/steps/6/cam_3/1771454038772_68b84258-67b4-4e0c-8b30-a08df844eda9.jpg","media_type":"image","backend_image_path":null}	1
1338	local:1	\N	job_step_started	\N	\N	2026-02-18 22:33:59.14	2026-02-18 22:33:59.14	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1339	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:34:00.279	2026-02-18 22:34:00.279	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771454040277.jpg","timestamp":"2026-02-18T22:34:00.279Z"}	0
1343	local:1	\N	job_step_completed	\N	\N	2026-02-18 22:34:16.004	2026-02-18 22:34:16.004	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1344	local:1	\N	job_stopped	\N	\N	2026-02-18 22:34:16.006	2026-02-18 22:34:16.006		{"job_id":4,"reason":"cancelled"}	1
1345	local:1	\N	job_started	\N	\N	2026-02-18 22:39:16.696	2026-02-18 22:39:16.696		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-18","local_time":"19:39","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":794,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-18T22:39:05.020Z","window":{"end_time":"23:00","id":794,"start_time":"19:39"}}}	1
1346	local:1	\N	job_step_started	\N	\N	2026-02-18 22:39:16.76	2026-02-18 22:39:16.76	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1347	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:39:17.953	2026-02-18 22:39:17.953	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771454357949.jpg","timestamp":"2026-02-18T22:39:17.953Z"}	0
1348	local:1	3	thumbnail_updated	\N	\N	2026-02-18 22:39:20.961	2026-02-18 22:39:20.961	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771454360956.jpg","timestamp":"2026-02-18T22:39:20.961Z"}	0
1349	local:1	\N	job_step_started	\N	\N	2026-02-18 22:39:25.916	2026-02-18 22:39:25.916	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1350	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:39:27.067	2026-02-18 22:39:27.067	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771454367066.jpg","timestamp":"2026-02-18T22:39:27.067Z"}	0
1351	local:1	\N	job_alert_triggered	\N	\N	2026-02-18 22:40:12.544	2026-02-18 22:40:12.544		{"agent_id":30,"agent_key":"black shirt finder","alert_condition_text":"se achar uma pessoa com blusa preta","answer":"Há uma pessoa visível nas imagens usando uma blusa preta.","camera_id":4,"camera_name":"Webcam webcam","channel":"none","clip_path":"C:\\\\Users\\\\nrag2\\\\AppData\\\\Local\\\\Temp\\\\jobsInferencePerceptrum\\\\Job_4\\\\step_7\\\\cam_4\\\\4_20260218_193927_20260218_194007_10s.mp4.processing","group_id":null,"group_name":null,"job_id":4,"job_name":"JOB TESTE","message_template":"","priority_level":"HIGH","prompt_template":"ache pessoas com blusas pretas\\n","rule_id":null,"step_id":7,"step_name":"step teste 2","step_order":2,"video_key":"job_alert_media/local_1/jobs/4/steps/7/cam_4/1771454412546_f91cd879-a191-4264-b6f8-1a574aac8d68.mp4","video_url":"http://localhost:4000/media/job_alert_media/local_1/jobs/4/steps/7/cam_4/1771454412546_f91cd879-a191-4264-b6f8-1a574aac8d68.mp4","media_type":"video","backend_clip_path":null,"clip_url":"http://localhost:4000/media/job_alert_media/local_1/jobs/4/steps/7/cam_4/1771454412546_f91cd879-a191-4264-b6f8-1a574aac8d68.mp4"}	1
1352	local:1	\N	job_alert_triggered	\N	\N	2026-02-18 22:40:12.784	2026-02-18 22:40:12.784		{"agent_id":-1,"agent_key":"person finder","alert_condition_text":"se achar qualquer pessoa","answer":"camera_id=3: Há uma pessoa visível na imagem.\\ncamera_id=4: Há uma pessoa visível na imagem.","camera_id":3,"camera_name":"mibo","channel":"none","clip_path":"","group_id":"group-1771454268486-499","group_name":"grupo teste","job_id":4,"job_name":"JOB TESTE","message_template":"","priority_level":"CRITIC","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","rule_id":null,"step_id":6,"step_name":"step teste 1 ","step_order":1,"image_key":"job_alert_media/local_1/jobs/4/steps/6/cam_3/1771454412796_7a7627d7-7434-4538-a270-abc2026f4e59.jpg","image_url":"http://localhost:4000/media/job_alert_media/local_1/jobs/4/steps/6/cam_3/1771454412796_7a7627d7-7434-4538-a270-abc2026f4e59.jpg","media_type":"image","backend_image_path":null}	1
1353	local:1	3	thumbnail_updated	\N	\N	2026-02-18 22:40:21.452	2026-02-18 22:40:21.452	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771454421447.jpg","timestamp":"2026-02-18T22:40:21.452Z"}	0
1354	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:40:27.103	2026-02-18 22:40:27.103	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771454427098.jpg","timestamp":"2026-02-18T22:40:27.103Z"}	0
1360	local:1	\N	job_started	\N	\N	2026-02-18 22:44:18.174	2026-02-18 22:44:18.174		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-18","local_time":"19:44","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":801,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-18T22:44:05.031Z","window":{"end_time":"23:00","id":801,"start_time":"19:44"}}}	1
1361	local:1	\N	job_step_started	\N	\N	2026-02-18 22:44:18.227	2026-02-18 22:44:18.227	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1362	local:1	4	thumbnail_updated	\N	\N	2026-02-18 22:44:19.398	2026-02-18 22:44:19.398	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771454659396.jpg","timestamp":"2026-02-18T22:44:19.398Z"}	0
1363	local:1	3	thumbnail_updated	\N	\N	2026-02-18 22:44:22.411	2026-02-18 22:44:22.411	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771454662409.jpg","timestamp":"2026-02-18T22:44:22.411Z"}	0
1364	local:1	\N	job_stop_requested	\N	\N	2026-02-18 22:44:26.039	2026-02-18 22:44:26.039	Job "JOB TESTE" stop requested.	\N	0
1365	local:1	\N	job_stopped	\N	\N	2026-02-18 22:44:33.179	2026-02-18 22:44:33.179	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1366	local:1	\N	job_step_completed	\N	\N	2026-02-18 22:44:34.671	2026-02-18 22:44:34.671	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1367	local:1	\N	job_stopped	\N	\N	2026-02-18 22:44:34.672	2026-02-18 22:44:34.672		{"job_id":4,"reason":"cancelled"}	1
1368	local:1	\N	job_started	\N	\N	2026-02-18 23:06:07.59	2026-02-18 23:06:07.59		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-18","local_time":"20:06","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":808,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-18T23:06:05.062Z","window":{"end_time":"23:00","id":808,"start_time":"20:06"}}}	1
1369	local:1	\N	job_step_started	\N	\N	2026-02-18 23:06:07.615	2026-02-18 23:06:07.615	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1370	local:1	4	thumbnail_updated	\N	\N	2026-02-18 23:06:08.795	2026-02-18 23:06:08.795	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771455968791.jpg","timestamp":"2026-02-18T23:06:08.795Z"}	0
1371	local:1	3	thumbnail_updated	\N	\N	2026-02-18 23:06:11.779	2026-02-18 23:06:11.779	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771455971778.jpg","timestamp":"2026-02-18T23:06:11.779Z"}	0
1372	local:1	4	thumbnail_updated	\N	\N	2026-02-18 23:07:08.819	2026-02-18 23:07:08.819	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771456028816.jpg","timestamp":"2026-02-18T23:07:08.819Z"}	0
1375	local:1	\N	job_step_completed	\N	\N	2026-02-18 23:07:24.047	2026-02-18 23:07:24.047	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1376	local:1	\N	job_stopped	\N	\N	2026-02-18 23:07:24.063	2026-02-18 23:07:24.063		{"job_id":4,"reason":"cancelled"}	1
1377	local:1	\N	job_started	\N	\N	2026-02-18 23:11:09.521	2026-02-18 23:11:09.521		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-18","local_time":"20:11","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":815,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-18T23:11:05.046Z","window":{"end_time":"23:00","id":815,"start_time":"20:11"}}}	1
1378	local:1	\N	job_step_started	\N	\N	2026-02-18 23:11:09.542	2026-02-18 23:11:09.542	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1379	local:1	4	thumbnail_updated	\N	\N	2026-02-18 23:11:10.736	2026-02-18 23:11:10.736	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771456270735.jpg","timestamp":"2026-02-18T23:11:10.736Z"}	0
1380	local:1	3	thumbnail_updated	\N	\N	2026-02-18 23:11:13.655	2026-02-18 23:11:13.655	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771456273651.jpg","timestamp":"2026-02-18T23:11:13.655Z"}	0
1381	local:1	\N	job_stop_requested	\N	\N	2026-02-18 23:11:47.575	2026-02-18 23:11:47.575	Job "JOB TESTE" stop requested.	\N	0
1382	local:1	\N	job_stopped	\N	\N	2026-02-18 23:11:54.592	2026-02-18 23:11:54.592	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1383	local:1	\N	job_step_completed	\N	\N	2026-02-18 23:11:56.207	2026-02-18 23:11:56.207	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1384	local:1	\N	job_stopped	\N	\N	2026-02-18 23:11:56.209	2026-02-18 23:11:56.209		{"job_id":4,"reason":"cancelled"}	1
1385	local:1	\N	job_started	\N	\N	2026-02-18 23:14:11.784	2026-02-18 23:14:11.784		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-18","local_time":"20:14","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":822,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-18T23:14:05.049Z","window":{"end_time":"23:00","id":822,"start_time":"20:14"}}}	1
1386	local:1	\N	job_step_started	\N	\N	2026-02-18 23:14:11.829	2026-02-18 23:14:11.829	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1387	local:1	4	thumbnail_updated	\N	\N	2026-02-18 23:14:12.957	2026-02-18 23:14:12.957	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771456452955.jpg","timestamp":"2026-02-18T23:14:12.957Z"}	0
1388	local:1	3	thumbnail_updated	\N	\N	2026-02-18 23:14:15.999	2026-02-18 23:14:15.999	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771456455996.jpg","timestamp":"2026-02-18T23:14:15.999Z"}	0
1389	local:1	\N	job_stop_requested	\N	\N	2026-02-18 23:14:24.876	2026-02-18 23:14:24.876	Job "JOB TESTE" stop requested.	\N	0
1390	local:1	\N	job_stopped	\N	\N	2026-02-18 23:14:26.777	2026-02-18 23:14:26.777	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1391	local:1	\N	job_step_completed	\N	\N	2026-02-18 23:14:29.938	2026-02-18 23:14:29.938	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1392	local:1	\N	job_stopped	\N	\N	2026-02-18 23:14:29.957	2026-02-18 23:14:29.957		{"job_id":4,"reason":"cancelled"}	1
1393	local:1	\N	job_started	\N	\N	2026-02-18 23:23:16.54	2026-02-18 23:23:16.54		{"job_id":4,"job_name":"JOB TESTE","trigger":{"local_date":"2026-02-18","local_time":"20:23","schedule_day":{"day_name":"Wednesday","day_of_month":null,"day_of_week":3,"id":829,"month_of_year":null},"schedule_mode":"weekly","timezone":"America/Sao_Paulo","trigger_type":"schedule","triggered_at_utc":"2026-02-18T23:23:05.016Z","window":{"end_time":"23:00","id":829,"start_time":"20:23"}}}	1
1394	local:1	\N	job_step_started	\N	\N	2026-02-18 23:23:16.604	2026-02-18 23:23:16.604	Step #1: step teste 1  started	{"job_id":4,"job_name":"JOB TESTE","step_id":6,"step_name":"step teste 1 ","step_order":1,"targets":2,"timeout_seconds":600}	1
1395	local:1	4	thumbnail_updated	\N	\N	2026-02-18 23:23:18.053	2026-02-18 23:23:18.053	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771456998051.jpg","timestamp":"2026-02-18T23:23:18.053Z"}	0
1396	local:1	3	thumbnail_updated	\N	\N	2026-02-18 23:23:20.858	2026-02-18 23:23:20.858	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771457000853.jpg","timestamp":"2026-02-18T23:23:20.858Z"}	0
1397	local:1	\N	job_step_started	\N	\N	2026-02-18 23:24:18.336	2026-02-18 23:24:18.336	Step #2: step teste 2 started	{"job_id":4,"job_name":"JOB TESTE","step_id":7,"step_name":"step teste 2","step_order":2,"targets":1,"timeout_seconds":120}	1
1398	local:1	4	thumbnail_updated	\N	\N	2026-02-18 23:24:19.56	2026-02-18 23:24:19.56	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_4_1771457059559.jpg","timestamp":"2026-02-18T23:24:19.560Z"}	0
1399	local:1	3	thumbnail_updated	\N	\N	2026-02-18 23:24:20.925	2026-02-18 23:24:20.925	Thumbnail updated	{"thumbnail_url":"user_local:1_camera_3_1771457060923.jpg","timestamp":"2026-02-18T23:24:20.925Z"}	0
1400	local:1	\N	job_stop_requested	\N	\N	2026-02-18 23:24:39.443	2026-02-18 23:24:39.443	Job "JOB TESTE" stop requested.	\N	0
1401	local:1	\N	job_stopped	\N	\N	2026-02-18 23:24:46.677	2026-02-18 23:24:46.677	Job "JOB TESTE" stopped (acknowledged by EXE).	\N	0
1402	local:1	\N	job_step_completed	\N	\N	2026-02-18 23:24:50.702	2026-02-18 23:24:50.702	Step #1: step teste 1  completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":6,"step_name":"step teste 1 ","step_order":1}	1
1403	local:1	\N	job_step_completed	\N	\N	2026-02-18 23:24:51.012	2026-02-18 23:24:51.012	Step #2: step teste 2 completed	{"job_id":4,"job_name":"JOB TESTE","reason":"job_cancel","step_id":7,"step_name":"step teste 2","step_order":2}	1
1404	local:1	\N	job_stopped	\N	\N	2026-02-18 23:24:51.014	2026-02-18 23:24:51.014		{"job_id":4,"reason":"cancelled"}	1
\.


--
-- TOC entry 5414 (class 0 OID 42890)
-- Dependencies: 237
-- Data for Name: exe_pairings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.exe_pairings (user_id, client_id, exe_id, exe_token_hash, paired_at, last_seen_at, status) FROM stdin;
local:1	local:1	exe-1771425334	4ed82977c1f38a6476c753938d1fedbb4e1f3e9ed39fc555be1b2147bc3c288a	2026-02-05T21:39:51.329Z	2026-02-18T23:52:39.896Z	connected
\.


--
-- TOC entry 5415 (class 0 OID 42896)
-- Dependencies: 238
-- Data for Name: faceid_targets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.faceid_targets (id, camera_id, person_name, person_description, created_at, updated_at, image_url) FROM stdin;
\.


--
-- TOC entry 5417 (class 0 OID 42904)
-- Dependencies: 240
-- Data for Name: job_run_alerts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_run_alerts (id, run_id, result_id, alert_rule_id, message, channel, sent_at, created_at) FROM stdin;
\.


--
-- TOC entry 5419 (class 0 OID 42911)
-- Dependencies: 242
-- Data for Name: job_runtime_states; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_runtime_states (job_id, user_id, job_name, status, started_at_utc, stopped_at_utc, last_event_at_utc, created_at, updated_at) FROM stdin;
3	local:1	Contagem	stopped	2026-02-10T12:00:06.672Z	2026-02-10T12:03:07.908Z	2026-02-10T12:03:07.908Z	2026-02-06 22:55:04.997	2026-02-10 12:03:07.908
6	local:1	Analise Recepcao SAP_C	stopped	2026-02-13T12:00:12.849Z	2026-02-13T12:01:28.207Z	2026-02-13T12:01:28.207Z	2026-02-10 17:35:05.004	2026-02-13 12:01:28.207
4	local:1	JOB TESTE	stopped	2026-02-18T23:23:16.549Z	2026-02-18T23:24:51.014Z	2026-02-18T23:24:51.014Z	2026-02-08 12:35:05.027	2026-02-18 23:24:51.014
\.


--
-- TOC entry 5420 (class 0 OID 42918)
-- Dependencies: 243
-- Data for Name: job_schedule_days; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_schedule_days (id, job_id, schedule_mode, day_name, day_of_week, day_of_month, month_of_year, sort_order, created_at, updated_at) FROM stdin;
1	1	weekly	Tuesday	2	\N	\N	0	2026-02-05 21:06:17.702	2026-02-05 21:06:17.702
2	2	weekly	Sunday	0	\N	\N	0	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
3	2	weekly	Monday	1	\N	\N	1	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
4	2	weekly	Tuesday	2	\N	\N	2	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
5	2	weekly	Wednesday	3	\N	\N	3	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
6	2	weekly	Thursday	4	\N	\N	4	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
7	2	weekly	Friday	5	\N	\N	5	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
8	2	weekly	Saturday	6	\N	\N	6	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
366	5	weekly	Sunday	0	\N	\N	0	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
367	5	weekly	Monday	1	\N	\N	1	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
368	5	weekly	Tuesday	2	\N	\N	2	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
369	5	weekly	Wednesday	3	\N	\N	3	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
370	5	weekly	Thursday	4	\N	\N	4	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
371	5	weekly	Friday	5	\N	\N	5	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
372	5	weekly	Saturday	6	\N	\N	6	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
93	3	weekly	Sunday	0	\N	\N	0	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
94	3	weekly	Monday	1	\N	\N	1	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
95	3	weekly	Tuesday	2	\N	\N	2	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
96	3	weekly	Wednesday	3	\N	\N	3	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
97	3	weekly	Thursday	4	\N	\N	4	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
98	3	weekly	Friday	5	\N	\N	5	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
99	3	weekly	Saturday	6	\N	\N	6	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
429	6	weekly	Sunday	0	\N	\N	0	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
430	6	weekly	Monday	1	\N	\N	1	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
431	6	weekly	Tuesday	2	\N	\N	2	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
432	6	weekly	Wednesday	3	\N	\N	3	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
433	6	weekly	Thursday	4	\N	\N	4	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
434	6	weekly	Friday	5	\N	\N	5	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
435	6	weekly	Saturday	6	\N	\N	6	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
826	4	weekly	Sunday	0	\N	\N	0	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
827	4	weekly	Monday	1	\N	\N	1	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
828	4	weekly	Tuesday	2	\N	\N	2	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
829	4	weekly	Wednesday	3	\N	\N	3	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
830	4	weekly	Thursday	4	\N	\N	4	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
831	4	weekly	Friday	5	\N	\N	5	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
832	4	weekly	Saturday	6	\N	\N	6	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
\.


--
-- TOC entry 5422 (class 0 OID 42926)
-- Dependencies: 245
-- Data for Name: job_schedule_fires; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_schedule_fires (id, fire_key, job_id, schedule_day_id, window_id, local_date, start_time, triggered_at_utc, created_at, updated_at) FROM stdin;
1	3:2026-02-06:35:19:55	3	35	35	2026-02-06	19:55	2026-02-06T22:55:04.997Z	2026-02-06 22:55:04.997	2026-02-06 22:55:04.997
2	3:2026-02-07:36:09:00	3	36	36	2026-02-07	09:00	2026-02-07T12:00:05.004Z	2026-02-07 12:00:05.004	2026-02-07 12:00:05.004
3	3:2026-02-07:43:10:59	3	43	43	2026-02-07	10:59	2026-02-07T13:59:05.007Z	2026-02-07 13:59:05.007	2026-02-07 13:59:05.007
4	3:2026-02-07:57:11:20	3	57	57	2026-02-07	11:20	2026-02-07T14:20:05.029Z	2026-02-07 14:20:05.029	2026-02-07 14:20:05.029
5	3:2026-02-07:64:11:40	3	64	64	2026-02-07	11:40	2026-02-07T14:40:05.047Z	2026-02-07 14:40:05.047	2026-02-07 14:40:05.047
6	3:2026-02-07:71:17:11	3	71	71	2026-02-07	17:11	2026-02-07T20:11:05.009Z	2026-02-07 20:11:05.009	2026-02-07 20:11:05.009
7	3:2026-02-07:78:17:28	3	78	78	2026-02-07	17:28	2026-02-07T20:28:05.008Z	2026-02-07 20:28:05.008	2026-02-07 20:28:05.008
8	3:2026-02-07:85:17:41	3	85	85	2026-02-07	17:41	2026-02-07T20:41:05.002Z	2026-02-07 20:41:05.002	2026-02-07 20:41:05.002
9	3:2026-02-08:86:08:13	3	86	86	2026-02-08	08:13	2026-02-08T11:13:05.011Z	2026-02-08 11:13:05.011	2026-02-08 11:13:05.011
10	3:2026-02-08:93:08:51	3	93	93	2026-02-08	08:51	2026-02-08T11:51:05.001Z	2026-02-08 11:51:05.001	2026-02-08 11:51:05.001
11	4:2026-02-08:107:09:35	4	107	107	2026-02-08	09:35	2026-02-08T12:35:05.027Z	2026-02-08 12:35:05.027	2026-02-08 12:35:05.027
12	4:2026-02-08:114:09:59	4	114	114	2026-02-08	09:59	2026-02-08T12:59:05.022Z	2026-02-08 12:59:05.022	2026-02-08 12:59:05.022
13	4:2026-02-08:121:10:25	4	121	121	2026-02-08	10:25	2026-02-08T13:25:05.010Z	2026-02-08 13:25:05.01	2026-02-08 13:25:05.01
14	4:2026-02-08:128:10:34	4	128	128	2026-02-08	10:34	2026-02-08T13:34:05.007Z	2026-02-08 13:34:05.007	2026-02-08 13:34:05.007
15	4:2026-02-08:135:10:42	4	135	135	2026-02-08	10:42	2026-02-08T13:42:05.011Z	2026-02-08 13:42:05.011	2026-02-08 13:42:05.011
16	4:2026-02-08:142:11:27	4	142	142	2026-02-08	11:27	2026-02-08T14:27:05.019Z	2026-02-08 14:27:05.019	2026-02-08 14:27:05.019
17	4:2026-02-08:149:11:48	4	149	149	2026-02-08	11:48	2026-02-08T14:48:05.045Z	2026-02-08 14:48:05.045	2026-02-08 14:48:05.045
18	4:2026-02-08:156:12:23	4	156	156	2026-02-08	12:23	2026-02-08T15:23:05.018Z	2026-02-08 15:23:05.018	2026-02-08 15:23:05.018
19	4:2026-02-08:163:12:43	4	163	163	2026-02-08	12:43	2026-02-08T15:43:05.034Z	2026-02-08 15:43:05.034	2026-02-08 15:43:05.034
20	4:2026-02-08:170:15:48	4	170	170	2026-02-08	15:48	2026-02-08T18:48:05.006Z	2026-02-08 18:48:05.006	2026-02-08 18:48:05.006
21	4:2026-02-08:177:16:17	4	177	177	2026-02-08	16:17	2026-02-08T19:17:05.024Z	2026-02-08 19:17:05.024	2026-02-08 19:17:05.024
22	4:2026-02-08:184:17:14	4	184	184	2026-02-08	17:14	2026-02-08T20:14:05.021Z	2026-02-08 20:14:05.021	2026-02-08 20:14:05.021
23	4:2026-02-08:191:17:34	4	191	191	2026-02-08	17:34	2026-02-08T20:34:05.000Z	2026-02-08 20:34:05	2026-02-08 20:34:05
24	3:2026-02-09:94:09:00	3	94	94	2026-02-09	09:00	2026-02-09T12:00:05.022Z	2026-02-09 12:00:05.022	2026-02-09 12:00:05.022
25	4:2026-02-09:192:09:00	4	192	192	2026-02-09	09:00	2026-02-09T12:00:05.022Z	2026-02-09 12:00:05.022	2026-02-09 12:00:05.022
26	4:2026-02-09:199:09:24	4	199	199	2026-02-09	09:24	2026-02-09T12:24:05.021Z	2026-02-09 12:24:05.021	2026-02-09 12:24:05.021
27	4:2026-02-09:206:09:30	4	206	206	2026-02-09	09:30	2026-02-09T12:30:05.020Z	2026-02-09 12:30:05.02	2026-02-09 12:30:05.02
28	4:2026-02-09:213:10:00	4	213	213	2026-02-09	10:00	2026-02-09T13:00:05.006Z	2026-02-09 13:00:05.006	2026-02-09 13:00:05.006
29	4:2026-02-09:220:11:29	4	220	220	2026-02-09	11:29	2026-02-09T14:29:05.021Z	2026-02-09 14:29:05.021	2026-02-09 14:29:05.021
30	4:2026-02-09:227:13:11	4	227	227	2026-02-09	13:11	2026-02-09T16:11:05.020Z	2026-02-09 16:11:05.02	2026-02-09 16:11:05.02
31	4:2026-02-09:248:13:17	4	248	248	2026-02-09	13:17	2026-02-09T16:17:05.042Z	2026-02-09 16:17:05.042	2026-02-09 16:17:05.042
32	4:2026-02-09:255:13:20	4	255	255	2026-02-09	13:20	2026-02-09T16:20:05.037Z	2026-02-09 16:20:05.037	2026-02-09 16:20:05.037
33	4:2026-02-09:262:13:26	4	262	262	2026-02-09	13:26	2026-02-09T16:26:05.012Z	2026-02-09 16:26:05.012	2026-02-09 16:26:05.012
34	4:2026-02-09:269:14:10	4	269	269	2026-02-09	14:10	2026-02-09T17:10:05.032Z	2026-02-09 17:10:05.032	2026-02-09 17:10:05.032
35	4:2026-02-09:276:20:05	4	276	276	2026-02-09	20:05	2026-02-09T23:05:05.003Z	2026-02-09 23:05:05.003	2026-02-09 23:05:05.003
36	4:2026-02-09:304:21:04	4	304	304	2026-02-09	21:04	2026-02-10T00:04:05.005Z	2026-02-10 00:04:05.005	2026-02-10 00:04:05.005
37	4:2026-02-09:318:21:50	4	318	318	2026-02-09	21:50	2026-02-10T00:50:05.033Z	2026-02-10 00:50:05.033	2026-02-10 00:50:05.033
38	4:2026-02-10:326:07:34	4	326	326	2026-02-10	07:34	2026-02-10T10:34:05.013Z	2026-02-10 10:34:05.013	2026-02-10 10:34:05.013
39	4:2026-02-10:333:08:03	4	333	333	2026-02-10	08:03	2026-02-10T11:03:05.007Z	2026-02-10 11:03:05.007	2026-02-10 11:03:05.007
40	4:2026-02-10:340:08:11	4	340	340	2026-02-10	08:11	2026-02-10T11:11:05.014Z	2026-02-10 11:11:05.014	2026-02-10 11:11:05.014
41	4:2026-02-10:347:08:21	4	347	347	2026-02-10	08:21	2026-02-10T11:21:05.008Z	2026-02-10 11:21:05.008	2026-02-10 11:21:05.008
42	4:2026-02-10:354:08:30	4	354	354	2026-02-10	08:30	2026-02-10T11:30:05.012Z	2026-02-10 11:30:05.012	2026-02-10 11:30:05.012
43	3:2026-02-10:95:09:00	3	95	95	2026-02-10	09:00	2026-02-10T12:00:05.032Z	2026-02-10 12:00:05.032	2026-02-10 12:00:05.032
44	4:2026-02-10:361:09:20	4	361	361	2026-02-10	09:20	2026-02-10T12:20:05.009Z	2026-02-10 12:20:05.009	2026-02-10 12:20:05.009
45	6:2026-02-10:382:14:35	6	382	382	2026-02-10	14:35	2026-02-10T17:35:05.004Z	2026-02-10 17:35:05.004	2026-02-10 17:35:05.004
46	6:2026-02-10:389:14:43	6	389	389	2026-02-10	14:43	2026-02-10T17:43:05.002Z	2026-02-10 17:43:05.002	2026-02-10 17:43:05.002
47	6:2026-02-10:396:14:47	6	396	396	2026-02-10	14:47	2026-02-10T17:47:05.003Z	2026-02-10 17:47:05.003	2026-02-10 17:47:05.003
48	6:2026-02-10:403:14:53	6	403	403	2026-02-10	14:53	2026-02-10T17:53:05.147Z	2026-02-10 17:53:05.147	2026-02-10 17:53:05.147
49	6:2026-02-10:410:15:01	6	410	410	2026-02-10	15:01	2026-02-10T18:01:05.014Z	2026-02-10 18:01:05.014	2026-02-10 18:01:05.014
50	6:2026-02-10:417:15:08	6	417	417	2026-02-10	15:08	2026-02-10T18:08:05.017Z	2026-02-10 18:08:05.017	2026-02-10 18:08:05.017
51	6:2026-02-10:424:15:15	6	424	424	2026-02-10	15:15	2026-02-10T18:15:05.005Z	2026-02-10 18:15:05.005	2026-02-10 18:15:05.005
52	6:2026-02-11:432:10:41	6	432	432	2026-02-11	10:41	2026-02-11T13:41:05.010Z	2026-02-11 13:41:05.01	2026-02-11 13:41:05.01
53	4:2026-02-13:441:07:52	4	441	441	2026-02-13	07:52	2026-02-13T10:52:05.010Z	2026-02-13 10:52:05.01	2026-02-13 10:52:05.01
54	4:2026-02-13:448:07:57	4	448	448	2026-02-13	07:57	2026-02-13T10:57:05.025Z	2026-02-13 10:57:05.025	2026-02-13 10:57:05.025
55	4:2026-02-13:455:08:26	4	455	455	2026-02-13	08:26	2026-02-13T11:26:05.009Z	2026-02-13 11:26:05.009	2026-02-13 11:26:05.009
56	4:2026-02-13:462:08:28	4	462	462	2026-02-13	08:28	2026-02-13T11:28:05.003Z	2026-02-13 11:28:05.003	2026-02-13 11:28:05.003
57	4:2026-02-13:469:08:56	4	469	469	2026-02-13	08:56	2026-02-13T11:56:05.008Z	2026-02-13 11:56:05.008	2026-02-13 11:56:05.008
58	4:2026-02-13:476:08:58	4	476	476	2026-02-13	08:58	2026-02-13T11:58:05.040Z	2026-02-13 11:58:05.04	2026-02-13 11:58:05.04
59	6:2026-02-13:434:09:00	6	434	434	2026-02-13	09:00	2026-02-13T12:00:05.005Z	2026-02-13 12:00:05.005	2026-02-13 12:00:05.005
60	4:2026-02-13:483:09:05	4	483	483	2026-02-13	09:05	2026-02-13T12:05:05.014Z	2026-02-13 12:05:05.014	2026-02-13 12:05:05.014
61	4:2026-02-13:490:09:40	4	490	490	2026-02-13	09:40	2026-02-13T12:40:05.004Z	2026-02-13 12:40:05.004	2026-02-13 12:40:05.004
62	4:2026-02-13:497:12:05	4	497	497	2026-02-13	12:05	2026-02-13T15:05:05.008Z	2026-02-13 15:05:05.008	2026-02-13 15:05:05.008
63	4:2026-02-13:504:12:20	4	504	504	2026-02-13	12:20	2026-02-13T15:20:05.022Z	2026-02-13 15:20:05.022	2026-02-13 15:20:05.022
64	4:2026-02-13:511:13:04	4	511	511	2026-02-13	13:04	2026-02-13T16:04:04.992Z	2026-02-13 16:04:04.992	2026-02-13 16:04:04.992
65	4:2026-02-13:518:18:14	4	518	518	2026-02-13	18:14	2026-02-13T21:14:05.049Z	2026-02-13 21:14:05.049	2026-02-13 21:14:05.049
66	4:2026-02-13:525:18:28	4	525	525	2026-02-13	18:28	2026-02-13T21:28:05.018Z	2026-02-13 21:28:05.018	2026-02-13 21:28:05.018
67	4:2026-02-13:532:18:32	4	532	532	2026-02-13	18:32	2026-02-13T21:32:05.031Z	2026-02-13 21:32:05.031	2026-02-13 21:32:05.031
68	4:2026-02-13:539:18:40	4	539	539	2026-02-13	18:40	2026-02-13T21:40:05.029Z	2026-02-13 21:40:05.029	2026-02-13 21:40:05.029
69	4:2026-02-13:546:18:44	4	546	546	2026-02-13	18:44	2026-02-13T21:44:05.021Z	2026-02-13 21:44:05.021	2026-02-13 21:44:05.021
70	4:2026-02-13:553:18:55	4	553	553	2026-02-13	18:55	2026-02-13T21:55:05.018Z	2026-02-13 21:55:05.018	2026-02-13 21:55:05.018
71	4:2026-02-13:560:18:59	4	560	560	2026-02-13	18:59	2026-02-13T21:59:05.014Z	2026-02-13 21:59:05.014	2026-02-13 21:59:05.014
72	4:2026-02-13:567:19:11	4	567	567	2026-02-13	19:11	2026-02-13T22:11:05.017Z	2026-02-13 22:11:05.017	2026-02-13 22:11:05.017
73	4:2026-02-13:574:19:57	4	574	574	2026-02-13	19:57	2026-02-13T22:57:05.037Z	2026-02-13 22:57:05.037	2026-02-13 22:57:05.037
74	4:2026-02-13:588:20:03	4	588	588	2026-02-13	20:03	2026-02-13T23:03:05.008Z	2026-02-13 23:03:05.008	2026-02-13 23:03:05.008
75	4:2026-02-13:595:20:06	4	595	595	2026-02-13	20:06	2026-02-13T23:06:05.017Z	2026-02-13 23:06:05.017	2026-02-13 23:06:05.017
76	4:2026-02-13:602:20:17	4	602	602	2026-02-13	20:17	2026-02-13T23:17:05.016Z	2026-02-13 23:17:05.016	2026-02-13 23:17:05.016
77	4:2026-02-14:610:12:39	4	610	610	2026-02-14	12:39	2026-02-14T15:39:05.030Z	2026-02-14 15:39:05.03	2026-02-14 15:39:05.03
78	4:2026-02-15:611:09:38	4	611	611	2026-02-15	09:38	2026-02-15T12:38:05.013Z	2026-02-15 12:38:05.013	2026-02-15 12:38:05.013
79	4:2026-02-15:618:10:03	4	618	618	2026-02-15	10:03	2026-02-15T13:03:05.011Z	2026-02-15 13:03:05.011	2026-02-15 13:03:05.011
80	4:2026-02-15:625:10:10	4	625	625	2026-02-15	10:10	2026-02-15T13:10:05.049Z	2026-02-15 13:10:05.049	2026-02-15 13:10:05.049
81	4:2026-02-16:633:12:25	4	633	633	2026-02-16	12:25	2026-02-16T15:25:05.030Z	2026-02-16 15:25:05.03	2026-02-16 15:25:05.03
82	4:2026-02-16:640:14:18	4	640	640	2026-02-16	14:18	2026-02-16T17:18:05.028Z	2026-02-16 17:18:05.028	2026-02-16 17:18:05.028
83	4:2026-02-17:648:09:43	4	648	648	2026-02-17	09:43	2026-02-17T12:43:05.005Z	2026-02-17 12:43:05.005	2026-02-17 12:43:05.005
84	4:2026-02-17:655:09:48	4	655	655	2026-02-17	09:48	2026-02-17T12:48:05.011Z	2026-02-17 12:48:05.011	2026-02-17 12:48:05.011
85	4:2026-02-17:662:09:51	4	662	662	2026-02-17	09:51	2026-02-17T12:51:05.026Z	2026-02-17 12:51:05.026	2026-02-17 12:51:05.026
86	4:2026-02-17:669:09:56	4	669	669	2026-02-17	09:56	2026-02-17T12:56:05.037Z	2026-02-17 12:56:05.037	2026-02-17 12:56:05.037
87	4:2026-02-17:676:10:44	4	676	676	2026-02-17	10:44	2026-02-17T13:44:05.018Z	2026-02-17 13:44:05.018	2026-02-17 13:44:05.018
88	4:2026-02-17:683:11:01	4	683	683	2026-02-17	11:01	2026-02-17T14:01:05.009Z	2026-02-17 14:01:05.009	2026-02-17 14:01:05.009
121	4:2026-02-17:716:11:06	4	716	716	2026-02-17	11:06	2026-02-17T14:06:05.009Z	2026-02-17 14:06:05.009	2026-02-17 14:06:05.009
122	4:2026-02-17:723:12:35	4	723	723	2026-02-17	12:35	2026-02-17T15:35:05.015Z	2026-02-17 15:35:05.015	2026-02-17 15:35:05.015
123	4:2026-02-17:730:12:38	4	730	730	2026-02-17	12:38	2026-02-17T15:38:05.033Z	2026-02-17 15:38:05.033	2026-02-17 15:38:05.033
124	4:2026-02-17:737:12:58	4	737	737	2026-02-17	12:58	2026-02-17T15:58:05.015Z	2026-02-17 15:58:05.015	2026-02-17 15:58:05.015
125	4:2026-02-17:744:13:40	4	744	744	2026-02-17	13:40	2026-02-17T16:40:05.035Z	2026-02-17 16:40:05.035	2026-02-17 16:40:05.035
126	4:2026-02-17:751:13:46	4	751	751	2026-02-17	13:46	2026-02-17T16:46:05.003Z	2026-02-17 16:46:05.003	2026-02-17 16:46:05.003
127	4:2026-02-17:758:13:49	4	758	758	2026-02-17	13:49	2026-02-17T16:49:05.018Z	2026-02-17 16:49:05.018	2026-02-17 16:49:05.018
128	4:2026-02-17:765:14:11	4	765	765	2026-02-17	14:11	2026-02-17T17:11:05.050Z	2026-02-17 17:11:05.05	2026-02-17 17:11:05.05
129	4:2026-02-18:773:18:40	4	773	773	2026-02-18	18:40	2026-02-18T21:40:05.022Z	2026-02-18 21:40:05.022	2026-02-18 21:40:05.022
130	4:2026-02-18:780:19:28	4	780	780	2026-02-18	19:28	2026-02-18T22:28:05.014Z	2026-02-18 22:28:05.014	2026-02-18 22:28:05.014
131	4:2026-02-18:787:19:33	4	787	787	2026-02-18	19:33	2026-02-18T22:33:05.034Z	2026-02-18 22:33:05.034	2026-02-18 22:33:05.034
132	4:2026-02-18:794:19:39	4	794	794	2026-02-18	19:39	2026-02-18T22:39:05.014Z	2026-02-18 22:39:05.014	2026-02-18 22:39:05.014
133	4:2026-02-18:801:19:44	4	801	801	2026-02-18	19:44	2026-02-18T22:44:05.013Z	2026-02-18 22:44:05.013	2026-02-18 22:44:05.013
134	4:2026-02-18:808:20:06	4	808	808	2026-02-18	20:06	2026-02-18T23:06:05.055Z	2026-02-18 23:06:05.055	2026-02-18 23:06:05.055
135	4:2026-02-18:815:20:11	4	815	815	2026-02-18	20:11	2026-02-18T23:11:05.040Z	2026-02-18 23:11:05.04	2026-02-18 23:11:05.04
136	4:2026-02-18:822:20:14	4	822	822	2026-02-18	20:14	2026-02-18T23:14:05.034Z	2026-02-18 23:14:05.034	2026-02-18 23:14:05.034
137	4:2026-02-18:829:20:23	4	829	829	2026-02-18	20:23	2026-02-18T23:23:05.005Z	2026-02-18 23:23:05.005	2026-02-18 23:23:05.005
\.


--
-- TOC entry 5424 (class 0 OID 42934)
-- Dependencies: 247
-- Data for Name: job_schedule_stops; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_schedule_stops (id, stop_key, job_id, schedule_day_id, window_id, local_date, end_time, triggered_at_utc, created_at, updated_at) FROM stdin;
1	3:2026-02-06:35:23:00:stop	3	35	35	2026-02-06	23:00	2026-02-07T02:00:05.020Z	2026-02-07 02:00:05.02	2026-02-07 02:00:05.02
2	3:2026-02-07:85:23:00:stop	3	85	85	2026-02-07	23:00	2026-02-08T02:00:05.029Z	2026-02-08 02:00:05.029	2026-02-08 02:00:05.029
3	3:2026-02-08:93:23:00:stop	3	93	93	2026-02-08	23:00	2026-02-09T02:00:04.996Z	2026-02-09 02:00:04.996	2026-02-09 02:00:04.996
4	4:2026-02-08:191:23:00:stop	4	191	191	2026-02-08	23:00	2026-02-09T02:00:04.996Z	2026-02-09 02:00:04.996	2026-02-09 02:00:04.996
5	4:2026-02-09:318:23:00:stop	4	318	318	2026-02-09	23:00	2026-02-10T02:00:05.025Z	2026-02-10 02:00:05.025	2026-02-10 02:00:05.025
6	4:2026-02-11:362:17:00:stop	4	362	362	2026-02-11	17:00	2026-02-11T20:00:05.048Z	2026-02-11 20:00:05.048	2026-02-11 20:00:05.048
7	3:2026-02-11:96:17:00:stop	3	96	96	2026-02-11	17:00	2026-02-11T20:00:05.048Z	2026-02-11 20:00:05.048	2026-02-11 20:00:05.048
8	6:2026-02-11:432:17:00:stop	6	432	432	2026-02-11	17:00	2026-02-11T20:00:05.048Z	2026-02-11 20:00:05.048	2026-02-11 20:00:05.048
9	3:2026-02-13:98:23:00:stop	3	98	98	2026-02-13	23:00	2026-02-14T02:00:05.004Z	2026-02-14 02:00:05.004	2026-02-14 02:00:05.004
10	4:2026-02-13:602:23:00:stop	4	602	602	2026-02-13	23:00	2026-02-14T02:00:05.004Z	2026-02-14 02:00:05.004	2026-02-14 02:00:05.004
\.


--
-- TOC entry 5426 (class 0 OID 42942)
-- Dependencies: 249
-- Data for Name: job_schedule_windows; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_schedule_windows (id, job_id, schedule_day_id, start_time, end_time, is_enabled, sort_order, created_at, updated_at) FROM stdin;
1	1	1	09:00	17:00	1	0	2026-02-05 21:06:17.702	2026-02-05 21:06:17.702
2	2	2	09:00	17:00	1	0	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
3	2	3	09:00	17:00	1	0	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
4	2	4	09:00	17:00	1	0	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
5	2	5	09:00	17:00	1	0	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
6	2	6	09:00	17:00	1	0	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
7	2	7	09:00	17:00	1	0	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
8	2	8	09:00	17:00	1	0	2026-02-06 21:38:50.705	2026-02-06 21:38:50.705
366	5	366	09:00	17:00	1	0	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
367	5	367	09:00	17:00	1	0	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
368	5	368	09:00	17:00	1	0	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
369	5	369	09:00	17:00	1	0	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
370	5	370	09:00	17:00	1	0	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
371	5	371	09:00	17:00	1	0	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
372	5	372	09:00	17:00	1	0	2026-02-10 13:53:56.082	2026-02-10 13:53:56.082
93	3	93	08:51	23:00	1	0	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
94	3	94	09:00	17:00	1	0	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
95	3	95	09:00	17:00	1	0	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
96	3	96	09:00	17:00	1	0	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
97	3	97	09:00	17:00	1	0	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
98	3	98	19:55	23:00	1	0	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
99	3	99	17:41	23:00	1	0	2026-02-08 11:50:04.419	2026-02-08 11:50:04.419
429	6	429	09:00	17:00	1	0	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
430	6	430	09:00	17:00	1	0	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
431	6	431	15:15	17:00	1	0	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
432	6	432	10:41	17:00	1	0	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
433	6	433	09:00	17:00	1	0	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
434	6	434	09:00	17:00	1	0	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
435	6	435	09:00	17:00	1	0	2026-02-11 13:40:15.779	2026-02-11 13:40:15.779
826	4	826	10:10	23:00	1	0	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
827	4	827	14:18	23:00	1	0	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
828	4	828	14:11	17:00	1	0	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
829	4	829	20:23	23:00	1	0	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
830	4	830	09:00	17:00	1	0	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
831	4	831	20:17	23:00	1	0	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
832	4	832	12:39	17:00	1	0	2026-02-18 23:22:46.09	2026-02-18 23:22:46.09
\.


--
-- TOC entry 5428 (class 0 OID 42951)
-- Dependencies: 251
-- Data for Name: job_step_agents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_step_agents (id, step_id, camera_id, agent_key, prompt_template, params, input_schema, is_active, created_at, updated_at, alert_condition, priority_level, input_type, inference_model) FROM stdin;
29	6	3	person finder	procure por pessoas\n\nalert_condition: se achar qualquer pessoa	{}	{}	1	2026-02-13 10:50:38.515	2026-02-18 23:04:58.568	se achar qualquer pessoa	CRITIC	video	pro
2	2	2	contagem pessoas saindo	Conte quantas pessoas visivelmente sairam do escritorio.	{}	{}	1	2026-02-06 21:48:39.173	2026-02-06 21:48:39.173	\N	MEDIUM	video	pro
4	3	3	contagem pessoas saindo sala	Conte quantas pessoas que visivelmente sairam da sala.	{}	{}	0	2026-02-06 21:51:44.984	2026-02-06 23:32:01.004	\N	MEDIUM	video	pro
3	2	3	contagem chegando sala	Conte quantas pessoas visivelmente entram na sala.	{}	{}	1	2026-02-06 21:49:49.677	2026-02-12 11:36:32.854	\N	CRITIC	video	pro
10	3	4	contagem chegada escritorio	conte quantas pessoas visivelmente entraram no escritorio\n\nalert_condition: pessoas > 0	{}	{}	1	2026-02-07 20:35:37.684	2026-02-07 20:35:37.684	pessoas > 0	MEDIUM	video	pro
11	3	3	contagem pessoas saindo sala	Conte quantas pessoas visivelmente sairam da sala.\n\nalert_condition: pessoas > 0	{}	{}	1	2026-02-07 20:35:45.47	2026-02-07 20:35:45.47	pessoas > 0	MEDIUM	video	pro
14	8	2	dog finder	procure cachorros na imagem\n\nalert_condition: se encontrar cachorro	{}	{}	1	2026-02-08 12:56:41.698	2026-02-08 12:56:41.698	se encontrar cachorro	MEDIUM	video	pro
24	7	3	pessoa finder	pessoa finder\n\nalert_condition: se encontrar alguma pessoa	{}	{}	0	2026-02-09 22:58:35.079	2026-02-13 15:02:13.087	se encontrar alguma pessoa	CRITIC	video	pro
23	6	4	person finder	procure por pessoas\n\nalert_condition: se achar qualquer pessoa	{}	{}	0	2026-02-09 22:48:07.862	2026-02-13 15:03:34.498	se achar qualquer pessoa	HIGH	video	pro
31	6	4	woman finder	ache alguma mulher de cabelo preto\n\nalert_condition: se achar alguma mulher de cabelo preto	{}	{}	1	2026-02-13 15:04:11.903	2026-02-13 15:04:11.903	se achar alguma mulher de cabelo preto	MEDIUM	video	pro
30	7	4	black shirt finder	ache pessoas com blusas pretas\n\nalert_condition: se achar uma pessoa com blusa preta	{}	{}	1	2026-02-13 15:02:42.682	2026-02-13 15:04:20.869	se achar uma pessoa com blusa preta	HIGH	video	pro
28	12	8	Mochila Raio X	Tarefa: detectar e alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).\n\nDefinições visuais do cenário:\n\nPortal alvo: arco detector com a palavra “GARRETT” em amarelo no topo.\n\nLinha de passagem: considere “passou pelo portal” quando o corpo inteiro (pés incluídos) atravessar o arco.\n\nSentido correto (ALERTA): pessoa se desloca do lado externo (onde aparecem as motos/entrada) para o lado interno da recepção (onde ficam o raio-x/esteira e lixeira preta pequena).\n\n\nSentido ignorado (NÃO alertar): pessoa indo do lado interno para fora (saindo), mesmo carregando mochila/bolsa/sacola/pacote.\n\nRegra obrigatória de orientação (anti-falso-positivo):\n\nSó gere alerta se a pessoa estiver vindo de frente para a câmera ao atravessar o portal.\n\n“De frente” significa que dá para ver parte do rosto ou a frente do tronco (peito/abdômen), e o movimento é em direção à câmera.\n\nSe a pessoa estiver de costas (costas/ombros dominantes, rosto não visível) ou claramente saindo, IGNORE, mesmo com mochila/bolsa/sacola/pacote.\n\nO que conta como item carregado:\n\nMochila nas costas, bolsa lateral, sacola, pacote/caixa, mochila/bolsa na mão.\n\nSe estiver em dúvida se existe item (ex.: objeto pequeno, parcialmente oculto), marque como “incerto” e não alerte.\n\nalert_condition: alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).	{}	{}	1	2026-02-10 17:32:32.74	2026-02-11 13:40:02.001	alertar somente quando uma pessoa carregando mochila/bolsa/sacola/pacote atravessar o portal de metal  no sentido de fora/entrada → para dentro da recepção, isto é, vindo na direção da câmera (de frente).	HIGH	video	pro
\.


--
-- TOC entry 5430 (class 0 OID 42961)
-- Dependencies: 253
-- Data for Name: job_step_alert_rules; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_step_alert_rules (id, step_id, condition_expr, channel, channel_params, message_template, created_at, updated_at) FROM stdin;
4	12	true	telegram	{}	Pessoa passou por Raio X com mochila/bolsa/sacola/pacote.	2026-02-10 17:33:07.287	2026-02-10 17:33:07.287
\.


--
-- TOC entry 5432 (class 0 OID 42969)
-- Dependencies: 255
-- Data for Name: job_step_run_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_step_run_logs (id, run_id, log_level, message, created_at) FROM stdin;
\.


--
-- TOC entry 5434 (class 0 OID 42976)
-- Dependencies: 257
-- Data for Name: job_step_run_results; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_step_run_results (id, run_id, result_data, output_data, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 5436 (class 0 OID 42984)
-- Dependencies: 259
-- Data for Name: job_step_runs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_step_runs (id, job_id, step_id, camera_id, step_agent_id, status, started_at, completed_at, timeout_at, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 5438 (class 0 OID 42993)
-- Dependencies: 261
-- Data for Name: job_step_targets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_step_targets (id, step_id, camera_id, created_at, updated_at) FROM stdin;
2	2	2	2026-02-06 21:41:49.551	2026-02-06 21:41:49.551
3	2	3	2026-02-06 21:41:54.162	2026-02-06 21:41:54.162
4	3	3	2026-02-06 21:50:52.221	2026-02-06 21:50:52.221
5	3	4	2026-02-06 21:50:55.627	2026-02-06 21:50:55.627
9	8	2	2026-02-08 12:56:19.557	2026-02-08 12:56:19.557
14	12	8	2026-02-10 17:27:00.672	2026-02-10 17:27:00.672
20	6	3	2026-02-13 10:49:32.949	2026-02-13 10:49:32.949
21	7	4	2026-02-13 15:02:15.705	2026-02-13 15:02:15.705
22	6	4	2026-02-13 15:03:42.813	2026-02-13 15:03:42.813
\.


--
-- TOC entry 5440 (class 0 OID 42999)
-- Dependencies: 263
-- Data for Name: job_steps; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.job_steps (id, job_id, step_order, name, timeout_seconds, status, input_from_step_id, input_inject_key, on_missing_input, created_at, updated_at, start_condition, start_condition_from_step_id, inference_groups) FROM stdin;
2	3	1	Contagem pessoas ida	300	draft	\N	\N	skip	2026-02-06 21:41:25.311	2026-02-06 21:41:25.311	\N	\N	\N
12	6	1	Passagem RAIO X	5000	draft	\N	\N	skip	2026-02-10 17:26:49.595	2026-02-10 14:26:53.296244	\N	\N	\N
5	3	4	teste final 2	300	draft	\N	\N	skip	2026-02-07 14:37:46.692	2026-02-07 11:37:56.514233	start:time:12:35	\N	\N
4	3	3	test final	300	draft	\N	\N	skip	2026-02-07 14:21:51.875	2026-02-07 19:51:28.642751	start:sequential	3	\N
8	4	3	step teste 3	600	draft	\N	\N	skip	2026-02-08 12:56:16.162	2026-02-08 12:20:56.726043	\N	\N	\N
3	3	2	Contagem pessoas volta	300	draft	\N	{"pipelines":[{"input_from_step_id":2,"input_inject_keys":["mibo"],"target_camera_id":4,"target_camera_name":"Webcam webcam"}]}	skip	2026-02-06 21:50:43.47	2026-02-13 07:49:19.461385	start:custom:if X happen...:hikvision escritorio	2	[]
7	4	2	step teste 2	120	draft	\N	{"pipelines":[{"input_from_step_id":6,"input_inject_keys":["Webcam webcam"],"target_camera_id":3,"target_camera_name":"mibo"}]}	skip	2026-02-08 12:32:24.209	2026-02-13 12:04:33.417323	start:custom:se uma pessoa for vista:mibo	6	\N
6	4	1	step teste 1 	600	draft	\N	\N	skip	2026-02-08 12:30:39.254	2026-02-18 19:37:48.505318	\N	\N	[{"id":"group-1771454268486-499","name":"grupo teste","targetIds":[20,22],"agentKey":"person finder","inputType":"image","prompt_template":"procure por pessoas\\n\\nalert_condition: se achar qualquer pessoa","alert_condition":"se achar qualquer pessoa","inference_model":"pro"}]
\.


--
-- TOC entry 5442 (class 0 OID 43009)
-- Dependencies: 265
-- Data for Name: jobs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.jobs (id, user_id, name, description, start_at, end_at, status, created_at, updated_at, schedule_mode, timezone, active_from, active_until) FROM stdin;
3	local:1	Contagem	Contagem	\N	\N	scheduled	2026-02-06 21:41:04.978	2026-02-08 08:50:04.442936	weekly	America/Sao_Paulo	2026-02-06	\N
6	local:1	Analise Recepcao SAP_C	recepcao sap CE	\N	\N	scheduled	2026-02-10 17:26:11.221	2026-02-11 10:40:15.810612	weekly	America/Cayenne	2026-02-10	\N
4	local:1	JOB TESTE	job para testar funcionalidades	\N	\N	scheduled	2026-02-08 12:29:46.07	2026-02-18 20:22:46.107107	weekly	America/Sao_Paulo	2026-02-08	\N
\.


--
-- TOC entry 5444 (class 0 OID 43018)
-- Dependencies: 267
-- Data for Name: local_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.local_sessions (id, session_token, user_id, expires_at, created_at) FROM stdin;
1	a092e08c-e8d4-4c42-992c-0340d9230a73	1	2026-03-07 20:44:38.62	2026-02-05 17:44:38.623898
2	e4cdde4a-fde4-439c-8508-27e39a819384	1	2026-03-07 20:44:44.124	2026-02-05 17:44:44.12461
3	6c1cce3a-3f3b-4e84-89ef-92c3cbdfab45	1	2026-03-07 20:45:36.91	2026-02-05 17:45:36.911536
4	458f573b-1709-4731-b5b7-a531b42ee5a8	1	2026-03-07 20:49:41.658	2026-02-05 17:49:41.660921
\.


--
-- TOC entry 5446 (class 0 OID 43025)
-- Dependencies: 269
-- Data for Name: local_users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.local_users (id, email, password_hash, email_verified, verify_token, reset_token, reset_token_expires_at, country_code, locale, last_login_at, created_at, updated_at) FROM stdin;
1	nrag2007@gmail.com	$2b$10$AyQhtAmPfecGOdwL3KGrE.HEkj2g4H3r0N51q4/jT1eqz./rB3OLK	0	\N	\N	\N	BR	\N	2026-02-05 20:49:41.644	2026-02-05 20:44:38.587	2026-02-05 20:49:41.644
\.


--
-- TOC entry 5469 (class 0 OID 51534)
-- Dependencies: 292
-- Data for Name: model_api_keys; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.model_api_keys (id, model_name, api_key, is_active, created_at, updated_at, default_fps) FROM stdin;
1	legacy	AIzaSyA_c5lgj1--kFYMDL0y4d58hXnT5-J-7M0	1	2026-02-18 18:37:21.735511	2026-02-18 18:37:21.735511	1
2	pro	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	1	2026-02-18 18:37:21.735511	2026-02-18 18:37:21.735511	3
3	ultra	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	1	2026-02-18 18:37:21.735511	2026-02-18 18:37:21.735511	5
\.


--
-- TOC entry 5448 (class 0 OID 43034)
-- Dependencies: 271
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.notifications (id, user_id, camera_id, type, title, message, image_key, created_at, is_read, event_id, video_key, media_type) FROM stdin;
\.


--
-- TOC entry 5450 (class 0 OID 43043)
-- Dependencies: 273
-- Data for Name: pair_codes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pair_codes (code, user_id, client_id, created_at, expires_at, used_at, id, pair_code) FROM stdin;
\.


--
-- TOC entry 5451 (class 0 OID 43048)
-- Dependencies: 274
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payments (id, user_id, stripe_payment_id, amount, currency, payment_type, status, description, created_at, updated_at) FROM stdin;
1	local:1	cs_live_a1qWKlTxFBz1GQjoPEstn2H2uYwuycpNG8fPde5T7YpxeoAf7MSMXrLFMM	3069	brl	subscription	completed	AI Subscription: 99 camera • Pro model • 1/1 analysis speed	2026-02-06 06:28:08.243872	2026-02-06 06:28:08.243872
2	local:1	cs_live_a14wQ7kh8C7Snnp53XMSLotSkiioWUFBoNlrS7gaz4DgTk1UXAR1gHO5Xq	262	brl	payment	completed	1000000 tokens	2026-02-06 09:05:17.662095	2026-02-06 09:05:17.662095
\.


--
-- TOC entry 5453 (class 0 OID 43057)
-- Dependencies: 276
-- Data for Name: reid_targets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.reid_targets (id, user_id, camera_id, target_name, description, image_key, created_at, updated_at, person_name, person_description) FROM stdin;
\.


--
-- TOC entry 5455 (class 0 OID 43065)
-- Dependencies: 278
-- Data for Name: stripe_customers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stripe_customers (id, user_id, stripe_customer_id, created_at, updated_at) FROM stdin;
2	local:1	cus_TvcZWBYCPTV6Po	2026-02-06 06:27:39.493488	2026-02-06 06:27:39.493488
\.


--
-- TOC entry 5457 (class 0 OID 43073)
-- Dependencies: 280
-- Data for Name: subscription_token_usage; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subscription_token_usage (id, subscription_id, camera_id, event_time, prompt_tokens, output_tokens, total_tokens, source, algo_type) FROM stdin;
1	2	2	2026-02-06T13:33:02.491Z	3227	47	3462	agent	multi
2	2	2	2026-02-06T13:33:17.695Z	3227	56	3544	agent	multi
3	2	2	2026-02-06T13:33:31.278Z	3227	46	3577	agent	multi
4	2	2	2026-02-06T13:39:11.951Z	3227	39	3379	agent	multi
5	2	2	2026-02-06T13:39:16.510Z	3227	39	3384	agent	multi
6	2	2	2026-02-06T13:39:27.554Z	3227	46	3479	agent	multi
7	2	2	2026-02-06T13:39:32.667Z	3227	60	3486	agent	multi
8	2	2	2026-02-06T13:39:43.719Z	3227	56	3390	agent	multi
9	2	2	2026-02-06T13:39:55.358Z	3227	40	3362	agent	multi
10	2	2	2026-02-06T13:40:08.176Z	3227	52	3451	agent	multi
11	2	2	2026-02-06T13:40:16.669Z	3227	40	3414	agent	multi
12	2	2	2026-02-06T21:31:02.924Z	3227	56	3391	agent	multi
13	2	2	2026-02-06T21:31:18.989Z	3227	57	3372	agent	multi
14	2	2	2026-02-06T21:31:30.281Z	3227	40	3443	agent	multi
\.


--
-- TOC entry 5459 (class 0 OID 43079)
-- Dependencies: 282
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subscriptions (id, user_id, stripe_subscription_id, plan_id, status, started_at, ended_at, cancel_at_period_end, created_at, updated_at, camera_count, seconds_per_frame, model_tier, "InputTokensM", "OutputTokensM", "InputTokensUsedM", "OutputTokensUsedM", inputtokensm, outputtokensm, inputtokensusedm, outputtokensusedm, camera_id, subscription_type, is_active, expires_at) FROM stdin;
2	local:1	sub_1SxlKT3n54CFNceJdRH9hswN	pro	active	2026-02-06 06:55:36.492321	\N	0	2026-02-06 06:55:36.492321	2026-02-06 18:31:30.286794	99	1	pro	999.9	999.9	0.045177992	0.00067400007	0	0	0	0	1	camera_monitoring_614	1	2026-03-06 06:55:36.492321
\.


--
-- TOC entry 5461 (class 0 OID 43100)
-- Dependencies: 284
-- Data for Name: telegram_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.telegram_settings (id, user_id, enabled, profile, chat_id, bot_token, created_at, updated_at) FROM stdin;
d2a5a00e-acae-434e-a2c1-5ab3009e358d	local:1	1		@CrimeDetectorCidadao	7772701347:AAGHIXSUedDnOXBsXogRjl4aN4vLGUzT4ps	2026-02-08 19:10:22.146	2026-02-08 19:10:33.594
\.


--
-- TOC entry 5462 (class 0 OID 43111)
-- Dependencies: 285
-- Data for Name: token_balances; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.token_balances (id, user_id, tokens, updated_at, balance, total_spent, created_at, input_balance, output_balance) FROM stdin;
1	local:1	0	2026-02-06 09:05:17.664087	100000000	0	2026-02-05 17:49:41.803544	100000000	100000000
\.


--
-- TOC entry 5464 (class 0 OID 43124)
-- Dependencies: 287
-- Data for Name: user_frame_rate; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_frame_rate (user_id, frame_rate, updated_at) FROM stdin;
local:1	12	2026-02-06T09:55:36.489Z
\.


--
-- TOC entry 5465 (class 0 OID 43129)
-- Dependencies: 288
-- Data for Name: user_preferences; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_preferences (user_id, language, theme, created_at, updated_at) FROM stdin;
local:1	pt	dark	2026-02-05 17:49:41.734672	2026-02-10 10:44:12.655417
\.


--
-- TOC entry 5466 (class 0 OID 43138)
-- Dependencies: 289
-- Data for Name: video_uploads; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.video_uploads (id, user_id, storage_key, public_url, original_name, mime_type, size_bytes, created_at, updated_at) FROM stdin;
1	demo-user	miw5sluk_71qkqycsa4x.mp4	/api/video-downloads/miw5sluk_71qkqycsa4x.mp4	abc123xyz.mp4	video/mp4	73797	2025-12-07 12:12:22.69355	2025-12-07 12:12:22.69355
\.


--
-- TOC entry 5490 (class 0 OID 0)
-- Dependencies: 218
-- Name: active_cards_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.active_cards_id_seq', 1, false);


--
-- TOC entry 5491 (class 0 OID 0)
-- Dependencies: 221
-- Name: camera_algorithms_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.camera_algorithms_id_seq', 1, true);


--
-- TOC entry 5492 (class 0 OID 0)
-- Dependencies: 223
-- Name: cameras_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cameras_id_seq', 8, true);


--
-- TOC entry 5493 (class 0 OID 0)
-- Dependencies: 225
-- Name: chat_hit_images_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.chat_hit_images_id_seq', 1, false);


--
-- TOC entry 5494 (class 0 OID 0)
-- Dependencies: 227
-- Name: chat_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.chat_messages_id_seq', 5, true);


--
-- TOC entry 5495 (class 0 OID 0)
-- Dependencies: 229
-- Name: chat_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.chat_sessions_id_seq', 39, true);


--
-- TOC entry 5496 (class 0 OID 0)
-- Dependencies: 231
-- Name: commands_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.commands_id_seq', 299, true);


--
-- TOC entry 5497 (class 0 OID 0)
-- Dependencies: 234
-- Name: detections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.detections_id_seq', 1, false);


--
-- TOC entry 5498 (class 0 OID 0)
-- Dependencies: 236
-- Name: events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.events_id_seq', 1404, true);


--
-- TOC entry 5499 (class 0 OID 0)
-- Dependencies: 239
-- Name: faceid_targets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.faceid_targets_id_seq', 1, false);


--
-- TOC entry 5500 (class 0 OID 0)
-- Dependencies: 241
-- Name: job_run_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_run_alerts_id_seq', 1, false);


--
-- TOC entry 5501 (class 0 OID 0)
-- Dependencies: 244
-- Name: job_schedule_days_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_schedule_days_id_seq', 832, true);


--
-- TOC entry 5502 (class 0 OID 0)
-- Dependencies: 246
-- Name: job_schedule_fires_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_schedule_fires_id_seq', 137, true);


--
-- TOC entry 5503 (class 0 OID 0)
-- Dependencies: 248
-- Name: job_schedule_stops_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_schedule_stops_id_seq', 10, true);


--
-- TOC entry 5504 (class 0 OID 0)
-- Dependencies: 250
-- Name: job_schedule_windows_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_schedule_windows_id_seq', 832, true);


--
-- TOC entry 5505 (class 0 OID 0)
-- Dependencies: 252
-- Name: job_step_agents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_step_agents_id_seq', 31, true);


--
-- TOC entry 5506 (class 0 OID 0)
-- Dependencies: 254
-- Name: job_step_alert_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_step_alert_rules_id_seq', 5, true);


--
-- TOC entry 5507 (class 0 OID 0)
-- Dependencies: 256
-- Name: job_step_run_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_step_run_logs_id_seq', 1, false);


--
-- TOC entry 5508 (class 0 OID 0)
-- Dependencies: 258
-- Name: job_step_run_results_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_step_run_results_id_seq', 1, false);


--
-- TOC entry 5509 (class 0 OID 0)
-- Dependencies: 260
-- Name: job_step_runs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_step_runs_id_seq', 1, false);


--
-- TOC entry 5510 (class 0 OID 0)
-- Dependencies: 262
-- Name: job_step_targets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_step_targets_id_seq', 23, true);


--
-- TOC entry 5511 (class 0 OID 0)
-- Dependencies: 264
-- Name: job_steps_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.job_steps_id_seq', 13, true);


--
-- TOC entry 5512 (class 0 OID 0)
-- Dependencies: 266
-- Name: jobs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.jobs_id_seq', 6, true);


--
-- TOC entry 5513 (class 0 OID 0)
-- Dependencies: 268
-- Name: local_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.local_sessions_id_seq', 4, true);


--
-- TOC entry 5514 (class 0 OID 0)
-- Dependencies: 270
-- Name: local_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.local_users_id_seq', 1, true);


--
-- TOC entry 5515 (class 0 OID 0)
-- Dependencies: 291
-- Name: model_api_keys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.model_api_keys_id_seq', 3, true);


--
-- TOC entry 5516 (class 0 OID 0)
-- Dependencies: 272
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.notifications_id_seq', 1, false);


--
-- TOC entry 5517 (class 0 OID 0)
-- Dependencies: 275
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payments_id_seq', 2, true);


--
-- TOC entry 5518 (class 0 OID 0)
-- Dependencies: 277
-- Name: reid_targets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.reid_targets_id_seq', 1, false);


--
-- TOC entry 5519 (class 0 OID 0)
-- Dependencies: 279
-- Name: stripe_customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stripe_customers_id_seq', 2, true);


--
-- TOC entry 5520 (class 0 OID 0)
-- Dependencies: 281
-- Name: subscription_token_usage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.subscription_token_usage_id_seq', 14, true);


--
-- TOC entry 5521 (class 0 OID 0)
-- Dependencies: 283
-- Name: subscriptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.subscriptions_id_seq', 3, true);


--
-- TOC entry 5522 (class 0 OID 0)
-- Dependencies: 286
-- Name: token_balances_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.token_balances_id_seq', 1, true);


--
-- TOC entry 5523 (class 0 OID 0)
-- Dependencies: 290
-- Name: video_uploads_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.video_uploads_id_seq', 1, true);


--
-- TOC entry 5083 (class 2606 OID 43165)
-- Name: active_cards active_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_cards
    ADD CONSTRAINT active_cards_pkey PRIMARY KEY (id);


--
-- TOC entry 5085 (class 2606 OID 43167)
-- Name: active_cards active_cards_stripe_payment_method_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_cards
    ADD CONSTRAINT active_cards_stripe_payment_method_id_key UNIQUE (stripe_payment_method_id);


--
-- TOC entry 5089 (class 2606 OID 43169)
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);


--
-- TOC entry 5092 (class 2606 OID 43171)
-- Name: camera_algorithms camera_algorithms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.camera_algorithms
    ADD CONSTRAINT camera_algorithms_pkey PRIMARY KEY (id);


--
-- TOC entry 5095 (class 2606 OID 43173)
-- Name: cameras cameras_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_pkey PRIMARY KEY (id);


--
-- TOC entry 5098 (class 2606 OID 43175)
-- Name: chat_hit_images chat_hit_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_hit_images
    ADD CONSTRAINT chat_hit_images_pkey PRIMARY KEY (id);


--
-- TOC entry 5102 (class 2606 OID 43177)
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- TOC entry 5106 (class 2606 OID 43179)
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- TOC entry 5109 (class 2606 OID 43181)
-- Name: commands commands_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commands
    ADD CONSTRAINT commands_pkey PRIMARY KEY (id);


--
-- TOC entry 5113 (class 2606 OID 43183)
-- Name: cron_locks cron_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cron_locks
    ADD CONSTRAINT cron_locks_pkey PRIMARY KEY (name);


--
-- TOC entry 5115 (class 2606 OID 43185)
-- Name: detections detections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detections
    ADD CONSTRAINT detections_pkey PRIMARY KEY (id);


--
-- TOC entry 5119 (class 2606 OID 43187)
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- TOC entry 5124 (class 2606 OID 43189)
-- Name: exe_pairings exe_pairings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exe_pairings
    ADD CONSTRAINT exe_pairings_pkey PRIMARY KEY (user_id);


--
-- TOC entry 5128 (class 2606 OID 43191)
-- Name: faceid_targets faceid_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.faceid_targets
    ADD CONSTRAINT faceid_targets_pkey PRIMARY KEY (id);


--
-- TOC entry 5133 (class 2606 OID 43193)
-- Name: job_run_alerts job_run_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_run_alerts
    ADD CONSTRAINT job_run_alerts_pkey PRIMARY KEY (id);


--
-- TOC entry 5137 (class 2606 OID 43195)
-- Name: job_runtime_states job_runtime_states_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_runtime_states
    ADD CONSTRAINT job_runtime_states_pkey PRIMARY KEY (job_id);


--
-- TOC entry 5140 (class 2606 OID 43197)
-- Name: job_schedule_days job_schedule_days_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_schedule_days
    ADD CONSTRAINT job_schedule_days_pkey PRIMARY KEY (id);


--
-- TOC entry 5144 (class 2606 OID 43199)
-- Name: job_schedule_fires job_schedule_fires_fire_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_schedule_fires
    ADD CONSTRAINT job_schedule_fires_fire_key_key UNIQUE (fire_key);


--
-- TOC entry 5146 (class 2606 OID 43201)
-- Name: job_schedule_fires job_schedule_fires_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_schedule_fires
    ADD CONSTRAINT job_schedule_fires_pkey PRIMARY KEY (id);


--
-- TOC entry 5150 (class 2606 OID 43203)
-- Name: job_schedule_stops job_schedule_stops_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_schedule_stops
    ADD CONSTRAINT job_schedule_stops_pkey PRIMARY KEY (id);


--
-- TOC entry 5152 (class 2606 OID 43205)
-- Name: job_schedule_stops job_schedule_stops_stop_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_schedule_stops
    ADD CONSTRAINT job_schedule_stops_stop_key_key UNIQUE (stop_key);


--
-- TOC entry 5156 (class 2606 OID 43207)
-- Name: job_schedule_windows job_schedule_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_schedule_windows
    ADD CONSTRAINT job_schedule_windows_pkey PRIMARY KEY (id);


--
-- TOC entry 5161 (class 2606 OID 43209)
-- Name: job_step_agents job_step_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_step_agents
    ADD CONSTRAINT job_step_agents_pkey PRIMARY KEY (id);


--
-- TOC entry 5166 (class 2606 OID 43211)
-- Name: job_step_alert_rules job_step_alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_step_alert_rules
    ADD CONSTRAINT job_step_alert_rules_pkey PRIMARY KEY (id);


--
-- TOC entry 5169 (class 2606 OID 43213)
-- Name: job_step_run_logs job_step_run_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_step_run_logs
    ADD CONSTRAINT job_step_run_logs_pkey PRIMARY KEY (id);


--
-- TOC entry 5172 (class 2606 OID 43215)
-- Name: job_step_run_results job_step_run_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_step_run_results
    ADD CONSTRAINT job_step_run_results_pkey PRIMARY KEY (id);


--
-- TOC entry 5177 (class 2606 OID 43217)
-- Name: job_step_runs job_step_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_step_runs
    ADD CONSTRAINT job_step_runs_pkey PRIMARY KEY (id);


--
-- TOC entry 5181 (class 2606 OID 43219)
-- Name: job_step_targets job_step_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_step_targets
    ADD CONSTRAINT job_step_targets_pkey PRIMARY KEY (id);


--
-- TOC entry 5185 (class 2606 OID 43221)
-- Name: job_steps job_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_steps
    ADD CONSTRAINT job_steps_pkey PRIMARY KEY (id);


--
-- TOC entry 5189 (class 2606 OID 43223)
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- TOC entry 5193 (class 2606 OID 43225)
-- Name: local_sessions local_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_sessions
    ADD CONSTRAINT local_sessions_pkey PRIMARY KEY (id);


--
-- TOC entry 5195 (class 2606 OID 43227)
-- Name: local_sessions local_sessions_session_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_sessions
    ADD CONSTRAINT local_sessions_session_token_key UNIQUE (session_token);


--
-- TOC entry 5199 (class 2606 OID 43229)
-- Name: local_users local_users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_users
    ADD CONSTRAINT local_users_email_key UNIQUE (email);


--
-- TOC entry 5201 (class 2606 OID 43231)
-- Name: local_users local_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_users
    ADD CONSTRAINT local_users_pkey PRIMARY KEY (id);


--
-- TOC entry 5245 (class 2606 OID 51545)
-- Name: model_api_keys model_api_keys_model_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.model_api_keys
    ADD CONSTRAINT model_api_keys_model_name_key UNIQUE (model_name);


--
-- TOC entry 5247 (class 2606 OID 51543)
-- Name: model_api_keys model_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.model_api_keys
    ADD CONSTRAINT model_api_keys_pkey PRIMARY KEY (id);


--
-- TOC entry 5205 (class 2606 OID 43233)
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- TOC entry 5210 (class 2606 OID 43235)
-- Name: pair_codes pair_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pair_codes
    ADD CONSTRAINT pair_codes_pkey PRIMARY KEY (code);


--
-- TOC entry 5213 (class 2606 OID 43237)
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- TOC entry 5217 (class 2606 OID 43239)
-- Name: reid_targets reid_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reid_targets
    ADD CONSTRAINT reid_targets_pkey PRIMARY KEY (id);


--
-- TOC entry 5221 (class 2606 OID 43241)
-- Name: stripe_customers stripe_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stripe_customers
    ADD CONSTRAINT stripe_customers_pkey PRIMARY KEY (id);


--
-- TOC entry 5224 (class 2606 OID 43243)
-- Name: subscription_token_usage subscription_token_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_token_usage
    ADD CONSTRAINT subscription_token_usage_pkey PRIMARY KEY (id);


--
-- TOC entry 5227 (class 2606 OID 43245)
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- TOC entry 5230 (class 2606 OID 43247)
-- Name: telegram_settings telegram_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_settings
    ADD CONSTRAINT telegram_settings_pkey PRIMARY KEY (id);


--
-- TOC entry 5232 (class 2606 OID 43249)
-- Name: telegram_settings telegram_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_settings
    ADD CONSTRAINT telegram_settings_user_id_key UNIQUE (user_id);


--
-- TOC entry 5235 (class 2606 OID 43251)
-- Name: token_balances token_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.token_balances
    ADD CONSTRAINT token_balances_pkey PRIMARY KEY (id);


--
-- TOC entry 5237 (class 2606 OID 43253)
-- Name: user_frame_rate user_frame_rate_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_frame_rate
    ADD CONSTRAINT user_frame_rate_pkey PRIMARY KEY (user_id);


--
-- TOC entry 5239 (class 2606 OID 43255)
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);


--
-- TOC entry 5242 (class 2606 OID 43257)
-- Name: video_uploads video_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_uploads
    ADD CONSTRAINT video_uploads_pkey PRIMARY KEY (id);


--
-- TOC entry 5086 (class 1259 OID 43258)
-- Name: idx_active_cards_payment_method_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_active_cards_payment_method_id ON public.active_cards USING btree (stripe_payment_method_id);


--
-- TOC entry 5087 (class 1259 OID 43259)
-- Name: idx_active_cards_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_active_cards_user_id ON public.active_cards USING btree (user_id);


--
-- TOC entry 5090 (class 1259 OID 43260)
-- Name: idx_app_users_email_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_app_users_email_unique ON public.app_users USING btree (email);


--
-- TOC entry 5093 (class 1259 OID 43261)
-- Name: idx_camera_algorithms_camera_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_camera_algorithms_camera_id ON public.camera_algorithms USING btree (camera_id);


--
-- TOC entry 5096 (class 1259 OID 43262)
-- Name: idx_cameras_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cameras_user_id ON public.cameras USING btree (user_id);


--
-- TOC entry 5099 (class 1259 OID 43263)
-- Name: idx_chat_hit_images_camera; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_hit_images_camera ON public.chat_hit_images USING btree (user_id, camera_id);


--
-- TOC entry 5100 (class 1259 OID 43264)
-- Name: idx_chat_hit_images_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_hit_images_session ON public.chat_hit_images USING btree (user_id, chat_session_id);


--
-- TOC entry 5103 (class 1259 OID 43265)
-- Name: idx_chat_messages_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at);


--
-- TOC entry 5104 (class 1259 OID 43266)
-- Name: idx_chat_messages_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_messages_user_id ON public.chat_messages USING btree (user_id);


--
-- TOC entry 5105 (class 1259 OID 43266)
-- Name: idx_chat_messages_user_usage_recorded_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_messages_user_usage_recorded_at ON public.chat_messages USING btree (user_id, usage_recorded_at);


--
-- TOC entry 5107 (class 1259 OID 43267)
-- Name: idx_chat_sessions_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_sessions_user_id ON public.chat_sessions USING btree (user_id);


--
-- TOC entry 5110 (class 1259 OID 43268)
-- Name: idx_commands_camera_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_commands_camera_id ON public.commands USING btree (camera_id);


--
-- TOC entry 5111 (class 1259 OID 43269)
-- Name: idx_commands_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_commands_status ON public.commands USING btree (status);


--
-- TOC entry 5116 (class 1259 OID 43270)
-- Name: idx_detections_detected_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_detections_detected_at ON public.detections USING btree (detected_at DESC);


--
-- TOC entry 5117 (class 1259 OID 43271)
-- Name: idx_detections_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_detections_user_id ON public.detections USING btree (user_id);


--
-- TOC entry 5120 (class 1259 OID 43272)
-- Name: idx_events_camera_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_events_camera_id ON public.events USING btree (camera_id);


--
-- TOC entry 5121 (class 1259 OID 43273)
-- Name: idx_events_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_events_created_at ON public.events USING btree (created_at);


--
-- TOC entry 5122 (class 1259 OID 43274)
-- Name: idx_events_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_events_user_id ON public.events USING btree (user_id);


--
-- TOC entry 5125 (class 1259 OID 43275)
-- Name: idx_exe_pairings_client_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_exe_pairings_client_id ON public.exe_pairings USING btree (client_id);


--
-- TOC entry 5126 (class 1259 OID 43276)
-- Name: idx_exe_pairings_exe_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_exe_pairings_exe_id ON public.exe_pairings USING btree (exe_id);


--
-- TOC entry 5129 (class 1259 OID 43277)
-- Name: idx_faceid_targets_camera_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_faceid_targets_camera_id ON public.faceid_targets USING btree (camera_id);


--
-- TOC entry 5130 (class 1259 OID 43278)
-- Name: idx_job_run_alerts_result_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_run_alerts_result_id ON public.job_run_alerts USING btree (result_id);


--
-- TOC entry 5131 (class 1259 OID 43279)
-- Name: idx_job_run_alerts_run_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_run_alerts_run_id ON public.job_run_alerts USING btree (run_id);


--
-- TOC entry 5134 (class 1259 OID 43280)
-- Name: idx_job_runtime_states_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_runtime_states_status ON public.job_runtime_states USING btree (status);


--
-- TOC entry 5135 (class 1259 OID 43281)
-- Name: idx_job_runtime_states_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_runtime_states_user_id ON public.job_runtime_states USING btree (user_id);


--
-- TOC entry 5138 (class 1259 OID 43282)
-- Name: idx_job_schedule_days_job_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_schedule_days_job_id ON public.job_schedule_days USING btree (job_id);


--
-- TOC entry 5141 (class 1259 OID 43283)
-- Name: idx_job_schedule_fires_fire_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_schedule_fires_fire_key ON public.job_schedule_fires USING btree (fire_key);


--
-- TOC entry 5142 (class 1259 OID 43284)
-- Name: idx_job_schedule_fires_job_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_schedule_fires_job_id ON public.job_schedule_fires USING btree (job_id);


--
-- TOC entry 5147 (class 1259 OID 43285)
-- Name: idx_job_schedule_stops_job_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_schedule_stops_job_id ON public.job_schedule_stops USING btree (job_id);


--
-- TOC entry 5148 (class 1259 OID 43286)
-- Name: idx_job_schedule_stops_stop_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_schedule_stops_stop_key ON public.job_schedule_stops USING btree (stop_key);


--
-- TOC entry 5153 (class 1259 OID 43287)
-- Name: idx_job_schedule_windows_job_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_schedule_windows_job_id ON public.job_schedule_windows USING btree (job_id);


--
-- TOC entry 5154 (class 1259 OID 43288)
-- Name: idx_job_schedule_windows_schedule_day_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_schedule_windows_schedule_day_id ON public.job_schedule_windows USING btree (schedule_day_id);


--
-- TOC entry 5157 (class 1259 OID 43289)
-- Name: idx_job_step_agents_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_agents_active ON public.job_step_agents USING btree (step_id, is_active);


--
-- TOC entry 5158 (class 1259 OID 43290)
-- Name: idx_job_step_agents_camera_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_agents_camera_id ON public.job_step_agents USING btree (step_id, camera_id);


--
-- TOC entry 5159 (class 1259 OID 43291)
-- Name: idx_job_step_agents_step_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_agents_step_id ON public.job_step_agents USING btree (step_id);


--
-- TOC entry 5164 (class 1259 OID 43292)
-- Name: idx_job_step_alert_rules_step_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_alert_rules_step_id ON public.job_step_alert_rules USING btree (step_id);


--
-- TOC entry 5167 (class 1259 OID 43293)
-- Name: idx_job_step_run_logs_run_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_run_logs_run_id ON public.job_step_run_logs USING btree (run_id);


--
-- TOC entry 5170 (class 1259 OID 43294)
-- Name: idx_job_step_run_results_run_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_run_results_run_id ON public.job_step_run_results USING btree (run_id);


--
-- TOC entry 5173 (class 1259 OID 43295)
-- Name: idx_job_step_runs_job_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_runs_job_id ON public.job_step_runs USING btree (job_id);


--
-- TOC entry 5174 (class 1259 OID 43296)
-- Name: idx_job_step_runs_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_runs_status ON public.job_step_runs USING btree (status);


--
-- TOC entry 5175 (class 1259 OID 43297)
-- Name: idx_job_step_runs_step_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_runs_step_id ON public.job_step_runs USING btree (step_id);


--
-- TOC entry 5178 (class 1259 OID 43298)
-- Name: idx_job_step_targets_step_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_step_targets_step_id ON public.job_step_targets USING btree (step_id);


--
-- TOC entry 5179 (class 1259 OID 43299)
-- Name: idx_job_step_targets_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_job_step_targets_unique ON public.job_step_targets USING btree (step_id, camera_id);


--
-- TOC entry 5182 (class 1259 OID 43300)
-- Name: idx_job_steps_job_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_steps_job_id ON public.job_steps USING btree (job_id);


--
-- TOC entry 5183 (class 1259 OID 43301)
-- Name: idx_job_steps_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_job_steps_order ON public.job_steps USING btree (job_id, step_order);


--
-- TOC entry 5186 (class 1259 OID 43302)
-- Name: idx_jobs_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_jobs_status ON public.jobs USING btree (status);


--
-- TOC entry 5187 (class 1259 OID 43303)
-- Name: idx_jobs_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_jobs_user_id ON public.jobs USING btree (user_id);


--
-- TOC entry 5190 (class 1259 OID 43304)
-- Name: idx_local_sessions_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_local_sessions_token ON public.local_sessions USING btree (session_token);


--
-- TOC entry 5191 (class 1259 OID 43305)
-- Name: idx_local_sessions_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_local_sessions_user_id ON public.local_sessions USING btree (user_id);


--
-- TOC entry 5196 (class 1259 OID 43306)
-- Name: idx_local_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_local_users_email ON public.local_users USING btree (email);


--
-- TOC entry 5197 (class 1259 OID 43307)
-- Name: idx_local_users_reset_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_local_users_reset_token ON public.local_users USING btree (reset_token);


--
-- TOC entry 5243 (class 1259 OID 51546)
-- Name: idx_model_api_keys_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_model_api_keys_active ON public.model_api_keys USING btree (is_active);


--
-- TOC entry 5202 (class 1259 OID 43308)
-- Name: idx_notifications_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_created ON public.notifications USING btree (created_at DESC);


--
-- TOC entry 5203 (class 1259 OID 43309)
-- Name: idx_notifications_user_read; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user_read ON public.notifications USING btree (user_id, is_read);


--
-- TOC entry 5206 (class 1259 OID 43310)
-- Name: idx_pair_codes_client_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pair_codes_client_id ON public.pair_codes USING btree (client_id);


--
-- TOC entry 5207 (class 1259 OID 43311)
-- Name: idx_pair_codes_pair_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pair_codes_pair_code ON public.pair_codes USING btree (pair_code);


--
-- TOC entry 5208 (class 1259 OID 43312)
-- Name: idx_pair_codes_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pair_codes_user_id ON public.pair_codes USING btree (user_id);


--
-- TOC entry 5211 (class 1259 OID 43313)
-- Name: idx_payments_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payments_user_id ON public.payments USING btree (user_id);


--
-- TOC entry 5214 (class 1259 OID 43314)
-- Name: idx_reid_targets_camera_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reid_targets_camera_id ON public.reid_targets USING btree (camera_id);


--
-- TOC entry 5215 (class 1259 OID 43315)
-- Name: idx_reid_targets_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reid_targets_user_id ON public.reid_targets USING btree (user_id);


--
-- TOC entry 5218 (class 1259 OID 43316)
-- Name: idx_stripe_customers_stripe_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_stripe_customers_stripe_id ON public.stripe_customers USING btree (stripe_customer_id);


--
-- TOC entry 5219 (class 1259 OID 43317)
-- Name: idx_stripe_customers_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_stripe_customers_user_id ON public.stripe_customers USING btree (user_id);


--
-- TOC entry 5222 (class 1259 OID 43318)
-- Name: idx_subscription_token_usage_subscription_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subscription_token_usage_subscription_id ON public.subscription_token_usage USING btree (subscription_id);


--
-- TOC entry 5223 (class 1259 OID 43318)
-- Name: idx_subscription_token_usage_subscription_event_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subscription_token_usage_subscription_event_time ON public.subscription_token_usage USING btree (subscription_id, event_time);


--
-- TOC entry 5225 (class 1259 OID 43319)
-- Name: idx_subscriptions_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);


--
-- TOC entry 5228 (class 1259 OID 43320)
-- Name: idx_telegram_settings_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_telegram_settings_user_id ON public.telegram_settings USING btree (user_id);


--
-- TOC entry 5233 (class 1259 OID 43321)
-- Name: idx_token_balances_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_token_balances_user_id ON public.token_balances USING btree (user_id);


--
-- TOC entry 5240 (class 1259 OID 43322)
-- Name: idx_video_uploads_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_video_uploads_user_id ON public.video_uploads USING btree (user_id);


--
-- TOC entry 5162 (class 1259 OID 43323)
-- Name: uq_job_step_agents_one_active_global; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_job_step_agents_one_active_global ON public.job_step_agents USING btree (step_id) WHERE ((is_active = 1) AND (camera_id IS NULL));


--
-- TOC entry 5163 (class 1259 OID 43324)
-- Name: uq_job_step_agents_one_active_per_camera; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_job_step_agents_one_active_per_camera ON public.job_step_agents USING btree (step_id, camera_id) WHERE ((is_active = 1) AND (camera_id IS NOT NULL));


--
-- TOC entry 5248 (class 2606 OID 43325)
-- Name: local_sessions fk_local_sessions_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_sessions
    ADD CONSTRAINT fk_local_sessions_user FOREIGN KEY (user_id) REFERENCES public.local_users(id);


-- Completed on 2026-02-18 21:09:10

--
-- PostgreSQL database dump complete
--
