import type { IsoDate } from './dates';
import type { JobStatus, Role } from './status';

export type AccessLevel = 'full' | 'read_only' | 'suspended' | 'none';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

export type MyCompany = {
  company_id: string;
  name: string;
  role: Role;
  access_level: AccessLevel;
  is_demo: boolean;
  trial_ends_at: string;
  subscription_status: SubscriptionStatus;
  store_ids: string[];
  crew_ids: string[];
};

export type Store = {
  id: string;
  company_id: string;
  name: string;
  nip: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  contact_person: string | null;
  notes: string | null;
  active: boolean;
  notify_email: boolean;
  notify_sms: boolean;
};

export type Crew = { id: string; company_id: string; name: string; color: string; is_default: boolean; active: boolean };

export type Job = {
  id: string;
  company_id: string;
  store_id: string;
  reference: string;
  status: JobStatus;
  customer_name: string;
  customer_phone: string | null;
  street: string;
  postal_code: string;
  city: string;
  description: string;
  estimated_duration: string | null;
  access_instructions: string | null;
  notes: string | null;
  requested_start: IsoDate;
  requested_end: IsoDate;
  confirmed_start: IsoDate | null;
  confirmed_end: IsoDate | null;
  crew_id: string | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  stores?: { name: string } | null;
  crews?: { name: string; color: string } | null;
};

export type Measurement = {
  id: string;
  job_id: string;
  label: string;
  width: number | null;
  height: number | null;
  unit: 'mm' | 'cm' | 'm';
  quantity: number;
  notes: string | null;
  position: number;
};

export type Attachment = {
  id: string;
  job_id: string;
  company_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  kind: 'photo' | 'measurement_doc' | 'other';
  uploaded_by: string | null;
  created_at: string;
};

export type JobNote = { id: string; job_id: string; is_internal: boolean; body: string; author_name: string; created_at: string };

export type Activity = {
  id: number;
  job_id: string;
  action: string;
  details: Record<string, any>;
  is_internal: boolean;
  actor_name: string;
  created_at: string;
};

export type AvailabilityDay = {
  day: IsoDate;
  total_crews: number;
  busy_crews: number;
  blocked: boolean;
  status: 'available' | 'partial' | 'full' | 'blocked';
  pending_requests: number | null;
};

export type AvailabilityBlock = {
  id: string;
  company_id: string;
  crew_id: string | null;
  start_date: IsoDate;
  end_date: IsoDate;
  reason: string | null;
  created_at: string;
};

export type OutboxRow = {
  id: string;
  event_type: string;
  channel: 'email' | 'sms';
  recipient: string;
  recipient_label: string | null;
  subject: string | null;
  body: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'mocked';
  attempts: number;
  last_error: string | null;
  provider: string | null;
  created_at: string;
  processed_at: string | null;
  job_id: string | null;
  announcement_id: string | null;
};
