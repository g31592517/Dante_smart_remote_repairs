import type { DeviceInput } from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { forbidden, notFound } from '../../core/errors.js';
import { db, type Db } from '../../db/knex.js';

export function mapDevice(d: Record<string, any>) {
  return {
    id: d.id,
    deviceType: d.device_type,
    manufacturer: d.manufacturer,
    model: d.model,
    operatingSystem: d.operating_system,
    serialNumber: d.serial_number,
    assetTag: d.asset_tag,
    department: d.department,
    location: d.location,
    notes: d.notes,
    organizationId: d.organization_id,
    ownerUserId: d.owner_user_id,
    createdAt: d.created_at,
  };
}

/** Devices a customer may use: their own, plus their organisation's devices. */
export function accessibleDevicesQuery(auth: AuthContext, conn: Db = db) {
  return conn('devices').where('is_active', true).andWhere((q) => {
    q.where('owner_user_id', auth.userId);
    if (auth.org) q.orWhere('organization_id', auth.org.id);
  });
}

export async function assertDeviceAccess(auth: AuthContext, deviceId: number, conn: Db = db) {
  const d = await conn('devices').where({ id: deviceId }).first();
  if (!d) throw notFound('Device');
  if (auth.isStaff) return d;
  const own = d.owner_user_id === auth.userId;
  const org = auth.org && d.organization_id === auth.org.id;
  if (!own && !org) throw notFound('Device');
  return d;
}

/** Corporate members register devices to the organisation; individuals to themselves. */
export async function createDevice(auth: AuthContext, input: DeviceInput, conn: Db = db): Promise<number> {
  const [id] = await conn('devices').insert({
    owner_user_id: auth.org ? null : auth.userId,
    organization_id: auth.org?.id ?? null,
    device_type: input.deviceType,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    operating_system: input.operatingSystem ?? null,
    serial_number: input.serialNumber ?? null,
    asset_tag: input.assetTag ?? null,
    department: input.department ?? null,
    location: input.location ?? null,
    notes: input.notes ?? null,
  });
  return id as number;
}

export async function updateDevice(auth: AuthContext, deviceId: number, input: Partial<DeviceInput>) {
  const d = await assertDeviceAccess(auth, deviceId);
  // within an organisation only org admins (or the original creator's own devices) may edit shared assets
  if (!auth.isStaff && d.organization_id && auth.org?.role !== 'ORG_ADMIN') throw forbidden('Only your organisation administrator can edit shared devices');
  await db('devices').where({ id: deviceId }).update({
    device_type: input.deviceType ?? d.device_type,
    manufacturer: input.manufacturer ?? d.manufacturer,
    model: input.model ?? d.model,
    operating_system: input.operatingSystem ?? d.operating_system,
    serial_number: input.serialNumber ?? d.serial_number,
    asset_tag: input.assetTag ?? d.asset_tag,
    department: input.department ?? d.department,
    location: input.location ?? d.location,
    notes: input.notes ?? d.notes,
  });
}

/** Every request ever raised for a device — the device's repair history. */
export async function deviceHistory(auth: AuthContext, deviceId: number) {
  await assertDeviceAccess(auth, deviceId);
  return db('support_requests as sr')
    .leftJoin('service_reports as rep', 'rep.support_request_id', 'sr.id')
    .where('sr.device_id', deviceId)
    .orderBy('sr.submitted_at', 'desc')
    .select('sr.id', 'sr.reference', 'sr.title', 'sr.service_type', 'sr.status', 'sr.submitted_at', 'sr.completed_at', 'rep.outcome')
    .then((rows) =>
      rows.map((r) => ({
        id: r.id, reference: r.reference, title: r.title, serviceType: r.service_type, status: r.status,
        submittedAt: r.submitted_at, completedAt: r.completed_at, outcome: r.outcome,
      })),
    );
}
