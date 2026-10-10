import { randomBytes, hkdfSync, createCipheriv, createDecipheriv } from 'node:crypto';

export function derive(master, session, label) {
  return Buffer.from(hkdfSync('sha256', master, Buffer.from(session), Buffer.from('codex-android-control/v1/' + label), 32));
}
export function credentials(master, session) {
  return { token: derive(master, session, 'auth').toString('base64url'), key: derive(master, session, 'encryption') };
}
export function seal(key, session, direction, seq, payload) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('invalid_sequence');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`${session}|${direction}|${seq}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { session, seq, nonce: nonce.toString('base64'), data: data.toString('base64') };
}
export function unseal(key, session, direction, lastSequence, frame) {
  if (!frame || frame.session !== session || !Number.isSafeInteger(frame.seq) || frame.seq <= lastSequence) throw new Error('replay_or_wrong_session');
  if (typeof frame.nonce !== 'string' || typeof frame.data !== 'string') throw new Error('invalid_frame');
  const nonce = Buffer.from(frame.nonce, 'base64');
  const data = Buffer.from(frame.data, 'base64');
  if (nonce.length !== 12 || data.length < 17 || data.length > 260000) throw new Error('invalid_frame');
  const cipher = createDecipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`${session}|${direction}|${frame.seq}`));
  cipher.setAuthTag(data.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]).toString('utf8'));
}
