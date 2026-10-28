-- Apply after 0001, against staging first. Existing public UUIDs are retained.
BEGIN;
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firebase_uid text UNIQUE,
  email text UNIQUE NOT NULL, full_name text, phone text, role text DEFAULT 'customer',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.pets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL, species text, breed text, age text, weight text, medical_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text,
  price numeric(10,2), duration text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pet_id uuid REFERENCES public.pets(id) ON DELETE SET NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  appointment_date date NOT NULL, appointment_time text NOT NULL,
  status text DEFAULT 'pending', notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, category text,
  price numeric(10,2) NOT NULL, stock integer DEFAULT 0, image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  total_amount numeric(10,2) NOT NULL, status text DEFAULT 'pending', payment_method text,
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','pets','services','appointments','products','orders'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS legacy_id text',t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS legacy_data jsonb NOT NULL DEFAULT ''{}''::jsonb',t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()',t);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I(legacy_id)',t||'_legacy_id_unique',t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin(legacy_data jsonb_path_ops)',t||'_legacy_data_gin',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  END LOOP;
END $$;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'active';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS fraud_status text DEFAULT 'normal';
ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS service_key text;
CREATE UNIQUE INDEX IF NOT EXISTS services_service_key_unique ON public.services(service_key);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS slot_id text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS assigned_staff text;

-- Historical documents may lack required native columns. Only rows explicitly
-- marked with an original document ID may retain those gaps; native rows keep
-- their original required-field guarantees. No dummy emails/dates are invented.
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.pets ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.services ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.appointments ALTER COLUMN appointment_date DROP NOT NULL;
ALTER TABLE public.appointments ALTER COLUMN appointment_time DROP NOT NULL;
ALTER TABLE public.products ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.products ALTER COLUMN price DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN total_amount DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='users_native_required' AND conrelid='public.users'::regclass) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_native_required CHECK(legacy_id IS NOT NULL OR email IS NOT NULL);
    ALTER TABLE public.pets ADD CONSTRAINT pets_native_required CHECK(legacy_id IS NOT NULL OR name IS NOT NULL);
    ALTER TABLE public.services ADD CONSTRAINT services_native_required CHECK(legacy_id IS NOT NULL OR name IS NOT NULL);
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_native_required CHECK(legacy_id IS NOT NULL OR (appointment_date IS NOT NULL AND appointment_time IS NOT NULL));
    ALTER TABLE public.products ADD CONSTRAINT products_native_required CHECK(legacy_id IS NOT NULL OR (name IS NOT NULL AND price IS NOT NULL));
    ALTER TABLE public.orders ADD CONSTRAINT orders_native_required CHECK(legacy_id IS NOT NULL OR total_amount IS NOT NULL);
  END IF;
END $$;
-- Replace the supplied cascade, including installations with a custom FK name.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.pets'::regclass AND contype='f' AND confrelid='public.users'::regclass LOOP
    EXECUTE format('ALTER TABLE public.pets DROP CONSTRAINT %I',c.conname);
  END LOOP;
  ALTER TABLE public.pets ADD CONSTRAINT pets_owner_id_fkey FOREIGN KEY(owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
END $$;
CREATE INDEX IF NOT EXISTS pets_owner_id_idx ON public.pets(owner_id);
CREATE INDEX IF NOT EXISTS appointments_user_date_idx ON public.appointments(user_id,appointment_date);
CREATE INDEX IF NOT EXISTS appointments_pet_id_idx ON public.appointments(pet_id);
CREATE INDEX IF NOT EXISTS appointments_slot_status_idx ON public.appointments(slot_id,status);

CREATE OR REPLACE FUNCTION app_private.relational_key(t text,r jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(r->>'legacy_id',CASE WHEN t='users' THEN r->>'firebase_uid' WHEN t='services' THEN r->>'service_key' END,r->>'id')
$$;
CREATE OR REPLACE FUNCTION app_private.resolve_relation(t text,k text) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE result uuid; BEGIN
  IF k IS NULL OR k='' THEN RETURN NULL; END IF;
  IF t NOT IN ('users','pets','services') THEN RAISE EXCEPTION 'Invalid relationship table'; END IF;
  EXECUTE format('SELECT id FROM public.%I r WHERE app_private.relational_key($1,to_jsonb(r))=$2 OR id::text=$2 LIMIT 1',t) INTO result USING t,k;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION app_private.related_key(t text,k text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE result text; BEGIN
  IF k IS NULL THEN RETURN NULL; END IF;
  IF t NOT IN ('users','pets','services') THEN RAISE EXCEPTION 'Invalid relationship table'; END IF;
  EXECUTE format('SELECT app_private.relational_key($1,to_jsonb(r)) FROM public.%I r WHERE id::text=$2',t) INTO result USING t,k;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION app_private.document_time(v jsonb) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
  IF v->>'__furfection_type__'='timestamp' THEN RETURN to_timestamp((v->>'seconds')::double precision+(v->>'nanoseconds')::double precision/1000000000); END IF;
  IF jsonb_typeof(v)='string' THEN RETURN (v#>>'{}')::timestamptz; END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION app_private.document_number(v jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
  IF (v#>>'{}') ~ '^-?[0-9]+([.][0-9]+)?$' THEN RETURN (v#>>'{}')::numeric; END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION app_private.canonical_status(s text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE lower(coalesce(s,'pending')) WHEN 'pending' THEN 'Pending' WHEN 'approved' THEN 'Approved'
    WHEN 'accepted' THEN 'Accepted' WHEN 'confirmed' THEN 'Confirmed' WHEN 'completed' THEN 'Completed'
    WHEN 'cancelled' THEN 'Cancelled' WHEN 'canceled' THEN 'Cancelled' WHEN 'rejected' THEN 'Rejected'
    WHEN 'expired' THEN 'No Show' WHEN 'no_show' THEN 'No Show' WHEN 'no-show' THEN 'No Show' WHEN 'no show' THEN 'No Show' ELSE s END
$$;
CREATE OR REPLACE FUNCTION app_private.native_payload(t text,r jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE d jsonb:=coalesce(r->'legacy_data','{}'); k text; s text; BEGIN
  k:=app_private.relational_key(t,r);
  IF t='users' THEN RETURN d||jsonb_build_object('uid',coalesce(r->>'firebase_uid',k),'email',r->'email','fullName',r->'full_name','name',r->'full_name','phone',r->'phone','username',r->'username','role',r->'role','accountStatus',r->'account_status','status',r->'account_status','fraudStatus',r->'fraud_status','createdAt',r->'created_at','updatedAt',r->'updated_at'); END IF;
  IF t='pets' THEN RETURN d||jsonb_build_object('id',k,'customerId',coalesce(app_private.related_key('users',r->>'owner_id'),d->>'customerId',d->>'ownerId'),'ownerId',coalesce(app_private.related_key('users',r->>'owner_id'),d->>'ownerId',d->>'customerId'),'petName',r->'name','petType',r->'species','breed',r->'breed','age',r->'age','weight',r->'weight','notes',r->'medical_notes','gender',r->'gender','createdAt',r->'created_at','updatedAt',r->'updated_at'); END IF;
  IF t='services' THEN RETURN d||jsonb_build_object('id',k,'name',r->'name','description',r->'description','price',r->'price','duration',r->'duration','createdAt',r->'created_at','updatedAt',r->'updated_at'); END IF;
  IF t='appointments' THEN
    s:=coalesce(app_private.related_key('services',r->>'service_id'),d->>'serviceId');
    RETURN d||jsonb_build_object('id',k,'customerId',coalesce(app_private.related_key('users',r->>'user_id'),d->>'customerId'),'petRecordId',coalesce(app_private.related_key('pets',r->>'pet_id'),d->>'petRecordId'),'serviceId',s,'serviceIds',coalesce(d->'serviceIds',CASE WHEN s IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(s) END),'scheduleDate',r->'appointment_date','scheduleTime',r->'appointment_time','slotId',r->'slot_id','assignedStaff',r->'assigned_staff','status',app_private.canonical_status(r->>'status'),'notes',r->'notes','createdAt',r->'created_at','updatedAt',r->'updated_at');
  END IF;
  IF t='products' THEN RETURN d||jsonb_build_object('id',k,'name',r->'name','category',r->'category','price',r->'price','stock',r->'stock','imageUrl',r->'image_url','createdAt',r->'created_at','updatedAt',r->'updated_at'); END IF;
  IF t='orders' THEN RETURN d||jsonb_build_object('id',k,'customerId',coalesce(app_private.related_key('users',r->>'user_id'),d->>'customerId'),'totalAmount',r->'total_amount','status',r->'status','paymentMethod',r->'payment_method','createdAt',r->'created_at','updatedAt',r->'updated_at'); END IF;
  RAISE EXCEPTION 'Unsupported relational table';
END $$;

CREATE OR REPLACE FUNCTION app_private.relational_columns(t text,d jsonb,r jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE v jsonb; owner_key text; owner_uuid uuid; service_key text; BEGIN
  v:=jsonb_build_object('created_at',coalesce(app_private.document_time(d->'createdAt'),(r->>'created_at')::timestamptz,now()),'updated_at',coalesce(app_private.document_time(d->'updatedAt'),now()));
  IF t='users' THEN RETURN v||jsonb_build_object('firebase_uid',coalesce(d->>'uid',r->>'firebase_uid',r->>'legacy_id'),'email',nullif(d->>'email',''),'full_name',coalesce(d->>'fullName',d->>'name'),'phone',d->'phone','username',d->'username','role',coalesce(d->>'role','customer'),'account_status',coalesce(d->>'accountStatus',d->>'status','active'),'fraud_status',coalesce(d->>'fraudStatus','normal')); END IF;
  owner_key:=coalesce(nullif(d->>'customerId',''),nullif(d->>'ownerId',''));
  owner_uuid:=app_private.resolve_relation('users',owner_key);
  IF owner_key IS NULL AND nullif(d->>'customerEmail','') IS NOT NULL THEN
    SELECT min(id::text)::uuid INTO owner_uuid FROM public.users WHERE lower(email)=lower(d->>'customerEmail') HAVING count(*)=1;
  END IF;
  IF t='pets' THEN RETURN v||jsonb_build_object('owner_id',owner_uuid,'name',d->'petName','species',d->'petType','breed',d->'breed','age',d->'age','weight',d->'weight','medical_notes',d->'notes','gender',d->'gender'); END IF;
  IF t='services' THEN RETURN v||jsonb_build_object('name',d->'name','description',d->'description','price',app_private.document_number(d->'price'),'duration',d->'duration'); END IF;
  IF t='appointments' THEN
    service_key:=coalesce(d->>'serviceId',d#>>'{serviceIds,0}');
    RETURN v||jsonb_build_object('user_id',owner_uuid,'pet_id',app_private.resolve_relation('pets',d->>'petRecordId'),'service_id',app_private.resolve_relation('services',service_key),'appointment_date',nullif(d->>'scheduleDate',''),'appointment_time',d->'scheduleTime','status',lower(coalesce(d->>'status','pending')),'notes',d->'notes','slot_id',d->'slotId','assigned_staff',d->'assignedStaff');
  END IF;
  IF t='products' THEN RETURN v||jsonb_build_object('name',d->'name','category',d->'category','price',app_private.document_number(d->'price'),'stock',coalesce(app_private.document_number(d->'stock'),0),'image_url',coalesce(d->'imageUrl',d->'imageURL')); END IF;
  IF t='orders' THEN RETURN v||jsonb_build_object('user_id',owner_uuid,'total_amount',app_private.document_number(d->'totalAmount'),'status',coalesce(d->>'status','pending'),'payment_method',d->'paymentMethod'); END IF;
  RAISE EXCEPTION 'Unsupported relational table';
END $$;

CREATE OR REPLACE FUNCTION app_private.sync_relational_row() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r jsonb:=to_jsonb(NEW); old_row jsonb; mapped jsonb; fields jsonb; col text; names jsonb; field text; d jsonb;
BEGIN
  IF current_setting('furfection.relink',true)='on' THEN RETURN NEW; END IF;
  IF (TG_OP='INSERT' AND NEW.legacy_id IS NOT NULL) OR (TG_OP='UPDATE' AND NEW.legacy_data IS DISTINCT FROM OLD.legacy_data) THEN
    NEW:=jsonb_populate_record(NEW,app_private.relational_columns(TG_TABLE_NAME,NEW.legacy_data,r));
    RETURN NEW;
  END IF;
  mapped:=app_private.native_payload(TG_TABLE_NAME,r);
  IF TG_OP='INSERT' THEN NEW.legacy_data:=mapped; RETURN NEW; END IF;
  old_row:=to_jsonb(OLD); d:=NEW.legacy_data;
  fields:=CASE TG_TABLE_NAME
    WHEN 'users' THEN '{"firebase_uid":["uid"],"email":["email"],"full_name":["fullName","name"],"phone":["phone"],"username":["username"],"role":["role"],"account_status":["accountStatus","status"],"fraud_status":["fraudStatus"]}'::jsonb
    WHEN 'pets' THEN '{"owner_id":["customerId","ownerId"],"name":["petName"],"species":["petType"],"breed":["breed"],"age":["age"],"weight":["weight"],"medical_notes":["notes"],"gender":["gender"]}'::jsonb
    WHEN 'services' THEN '{"name":["name"],"description":["description"],"price":["price"],"duration":["duration"]}'::jsonb
    WHEN 'appointments' THEN '{"user_id":["customerId"],"pet_id":["petRecordId"],"service_id":["serviceId"],"appointment_date":["scheduleDate"],"appointment_time":["scheduleTime"],"status":["status"],"notes":["notes"],"slot_id":["slotId"],"assigned_staff":["assignedStaff"]}'::jsonb
    WHEN 'products' THEN '{"name":["name"],"category":["category"],"price":["price"],"stock":["stock"],"image_url":["imageUrl"]}'::jsonb
    WHEN 'orders' THEN '{"user_id":["customerId"],"total_amount":["totalAmount"],"status":["status"],"payment_method":["paymentMethod"]}'::jsonb END;
  fields:=fields||'{"created_at":["createdAt"],"updated_at":["updatedAt"]}'::jsonb;
  FOR col,names IN SELECT key,value FROM jsonb_each(fields) LOOP
    IF r->col IS DISTINCT FROM old_row->col THEN
      FOR field IN SELECT jsonb_array_elements_text(names) LOOP d:=jsonb_set(d,ARRAY[field],coalesce(mapped->field,'null'::jsonb),true); END LOOP;
    END IF;
  END LOOP;
  IF TG_TABLE_NAME='appointments' THEN
    IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
      d:=jsonb_set(d,'{serviceIds}',CASE WHEN mapped->>'serviceId' IS NULL THEN coalesce(d->'serviceIds','[]') ELSE jsonb_build_array(mapped->>'serviceId') END,true);
    END IF;
  END IF;
  NEW.legacy_data:=d;
  RETURN NEW;
END $$;
-- Trigger records are polymorphic: service_id only exists on appointments.
-- The guarded branch above is evaluated only for that table.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','pets','services','appointments','products','orders'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sync_relational_row ON public.%I',t);
    EXECUTE format('CREATE TRIGGER sync_relational_row BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.sync_relational_row()',t);
    EXECUTE format('UPDATE public.%I r SET legacy_data=app_private.native_payload($1,to_jsonb(r)) WHERE legacy_id IS NULL AND legacy_data=''{}''::jsonb',t) USING t;
    EXECUTE format('CREATE OR REPLACE VIEW app_private.%I WITH (security_invoker=true) AS SELECT coalesce(legacy_id,%sid::text) COLLATE "C" AS id, legacy_data AS data, updated_at FROM public.%I r',t||'_relational',CASE WHEN t='users' THEN 'firebase_uid,' WHEN t='services' THEN 'service_key,' ELSE '' END,t);
    EXECUTE format('REVOKE ALL ON app_private.%I FROM PUBLIC,anon,authenticated',t||'_relational');
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I ((coalesce(legacy_id,%sid::text) COLLATE "C"))',t||'_document_key_unique',t,CASE WHEN t='users' THEN 'firebase_uid,' WHEN t='services' THEN 'service_key,' ELSE '' END);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app_private.upsert_relational_document(t text,k text,d jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$ DECLARE target uuid; BEGIN
  IF t NOT IN ('users','pets','services','appointments','products','orders') OR k IS NULL OR k='' OR position('/' in k)>0 OR jsonb_typeof(d)<>'object' THEN RAISE EXCEPTION 'Invalid relational document'; END IF;
  EXECUTE format('SELECT id FROM public.%I r WHERE app_private.relational_key($1,to_jsonb(r))=$2 FOR UPDATE',t) INTO target USING t,k;
  -- Explicit Firebase identity can bind an existing native profile. Never merge
  -- unrelated accounts by email or silently replace a UUID.
  IF target IS NULL AND t='users' AND nullif(d->>'uid','') IS NOT NULL THEN
    SELECT id INTO target FROM public.users WHERE legacy_id IS NULL AND firebase_uid=d->>'uid' FOR UPDATE;
  END IF;
  IF target IS NULL THEN
    EXECUTE format('INSERT INTO public.%I(legacy_id,legacy_data) VALUES($1,$2) RETURNING id',t) INTO target USING k,d;
  ELSE
    EXECUTE format('UPDATE public.%I SET legacy_id=coalesce(legacy_id,$1),legacy_data=$2,updated_at=clock_timestamp() WHERE id=$3 AND legacy_data IS DISTINCT FROM $2',t) USING k,d,target;
  END IF;
  RETURN target;
END $$;
CREATE OR REPLACE FUNCTION app_private.delete_relational_document(t text,k text) RETURNS boolean
LANGUAGE plpgsql SET search_path='' AS $$ DECLARE target uuid; BEGIN
  IF t NOT IN ('users','pets','services','appointments','products','orders') OR k IS NULL OR k='' THEN
    RAISE EXCEPTION 'Invalid relational document';
  END IF;
  EXECUTE format('SELECT id FROM public.%I r WHERE app_private.relational_key($1,to_jsonb(r))=$2 FOR UPDATE',t)
    INTO target USING t,k;
  IF target IS NULL THEN RETURN false; END IF;
  EXECUTE format('DELETE FROM public.%I WHERE id=$1',t) USING target;
  RETURN true;
END $$;

CREATE TABLE IF NOT EXISTS public.appointment_services (
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK(position>=0), service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_key text NOT NULL, PRIMARY KEY(appointment_id,position)
);
ALTER TABLE public.appointment_services ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_services FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS appointment_services_service_idx ON public.appointment_services(service_id);
CREATE OR REPLACE FUNCTION app_private.sync_appointment_links() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ DECLARE keys jsonb; BEGIN
  IF TG_OP='UPDATE' AND NEW.legacy_data IS NOT DISTINCT FROM OLD.legacy_data THEN RETURN NEW; END IF;
  keys:=coalesce(NEW.legacy_data->'serviceIds',CASE WHEN NEW.legacy_data->>'serviceId' IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(NEW.legacy_data->>'serviceId') END);
  DELETE FROM public.appointment_services WHERE appointment_id=NEW.id;
  IF jsonb_typeof(keys)='array' THEN
    INSERT INTO public.appointment_services(appointment_id,position,service_id,service_key)
      SELECT NEW.id,(ordinality-1)::integer,app_private.resolve_relation('services',value),value FROM jsonb_array_elements_text(keys) WITH ORDINALITY;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_appointment_links ON public.appointments;
CREATE TRIGGER sync_appointment_links AFTER INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION app_private.sync_appointment_links();

-- Copy prior private staging documents without deleting their backup tables.
DO $$ DECLARE t text; r record; BEGIN
  FOREACH t IN ARRAY ARRAY['users','services','pets','appointments'] LOOP
    FOR r IN EXECUTE format('SELECT id,data FROM app_private.%I',t) LOOP
      PERFORM app_private.upsert_relational_document(t,r.id,r.data);
    END LOOP;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION app_private.relink_relational_records() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ DECLARE prior text:=current_setting('furfection.relink',true); BEGIN
  PERFORM set_config('furfection.relink','on',true);
  UPDATE public.pets p SET owner_id=app_private.resolve_relation('users',coalesce(p.legacy_data->>'customerId',p.legacy_data->>'ownerId')) WHERE p.legacy_id IS NOT NULL;
  UPDATE public.appointments a SET user_id=app_private.resolve_relation('users',a.legacy_data->>'customerId'),pet_id=app_private.resolve_relation('pets',a.legacy_data->>'petRecordId'),service_id=app_private.resolve_relation('services',coalesce(a.legacy_data->>'serviceId',a.legacy_data#>>'{serviceIds,0}')) WHERE a.legacy_id IS NOT NULL;
  UPDATE public.orders o SET user_id=app_private.resolve_relation('users',o.legacy_data->>'customerId') WHERE o.legacy_id IS NOT NULL;
  UPDATE public.appointment_services s SET service_id=app_private.resolve_relation('services',s.service_key);
  PERFORM set_config('furfection.relink',coalesce(prior,''),true);
END $$;
SELECT app_private.relink_relational_records();

-- Reuse the existing minimal event emitter against canonical payloads. The
-- original private tables remain backups, not a second active data source.
CREATE OR REPLACE FUNCTION app_private.emit_relational_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n record; o record; new_key text; old_key text; payload jsonb; uid text; old_uid text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.legacy_data IS NOT DISTINCT FROM OLD.legacy_data THEN RETURN NEW; END IF;
  IF TG_OP<>'DELETE' THEN new_key:=app_private.relational_key(TG_TABLE_NAME,to_jsonb(NEW)); END IF;
  IF TG_OP<>'INSERT' THEN old_key:=app_private.relational_key(TG_TABLE_NAME,to_jsonb(OLD)); END IF;
  payload:=CASE WHEN TG_OP='DELETE' THEN OLD.legacy_data ELSE NEW.legacy_data END;
  uid:=coalesce(nullif(payload->>'customerId',''),nullif(payload->>'ownerId',''));
  IF TG_TABLE_NAME='users' THEN uid:=coalesce(payload->>'uid',new_key,old_key); END IF;
  IF uid IS NULL AND nullif(payload->>'customerEmail','') IS NOT NULL THEN
    SELECT coalesce(firebase_uid,legacy_id,id::text) INTO uid FROM public.users WHERE lower(email)=lower(payload->>'customerEmail') LIMIT 1;
  END IF;
  INSERT INTO public.database_changes(collection_name,document_id,audience_uid,operation) VALUES(TG_TABLE_NAME,coalesce(new_key,old_key),uid,TG_OP);
  IF TG_OP='UPDATE' THEN
    old_uid:=coalesce(nullif(OLD.legacy_data->>'customerId',''),nullif(OLD.legacy_data->>'ownerId',''));
    IF TG_TABLE_NAME='users' THEN old_uid:=coalesce(OLD.legacy_data->>'uid',old_key); END IF;
    IF old_key IS DISTINCT FROM new_key OR old_uid IS DISTINCT FROM uid THEN
      INSERT INTO public.database_changes(collection_name,document_id,audience_uid,operation) VALUES(TG_TABLE_NAME,old_key,old_uid,CASE WHEN old_key IS DISTINCT FROM new_key THEN 'DELETE' ELSE 'UPDATE' END);
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','pets','services','appointments','products','orders'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS emit_relational_change ON public.%I',t);
    EXECUTE format('CREATE TRIGGER emit_relational_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.emit_relational_change()',t);
  END LOOP;
END $$;
-- Update security functions to read public-backed profiles rather than backups.
DO $$ DECLARE body text; BEGIN
  SELECT pg_get_functiondef('app_private.can_receive_change(text,text)'::regprocedure) INTO body;
  body:=replace(body,'app_private.users u','app_private.users_relational u');
  EXECUTE body;
  SELECT pg_get_functiondef('app_private.emit_database_change()'::regprocedure) INTO body;
  body:=replace(body,'app_private.users u','app_private.users_relational u');
  EXECUTE body;
END $$;
-- Keep native tables out of logical replication; only the authorized minimal
-- insert-event table should be published for browser synchronization.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename IN ('users','pets','services','appointments','products','orders','appointment_services') LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I',r.schemaname,r.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.can_receive_change(text,text) TO authenticated;
COMMIT;
