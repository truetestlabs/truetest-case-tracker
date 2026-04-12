import { readFileSync } from 'fs';
const envContent = readFileSync('.env', 'utf8');
for (const line of envContent.split('\n')) {
  const eqIdx = line.indexOf('=');
  if (eqIdx === -1 || line.startsWith('#')) continue;
  const key = line.slice(0, eqIdx);
  let val = line.slice(eqIdx + 1).trim();
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
  if (/^[A-Z_]/.test(key)) process.env[key] = val;
}

// Force impersonation like Vercel does
process.env.GOOGLE_CALENDAR_IMPERSONATE = 'michael@truetestlabs.com';

const { createCalendarEvent } = await import('../src/lib/gcal.ts');

const testDate = new Date('2026-05-10T15:00:00Z'); // 10am Chicago
const testEnd = new Date('2026-05-10T15:30:00Z');

console.log('Testing createCalendarEvent with calendarId=primary...');
const eventId = await createCalendarEvent({
  summary: 'TEST — gcal write test',
  description: 'Testing if primary works for insert',
  start: testDate,
  end: testEnd,
});
console.log('Result:', eventId);

// Clean up if successful
if (eventId) {
  const { deleteCalendarEvent } = await import('../src/lib/gcal.ts');
  await deleteCalendarEvent(eventId);
  console.log('Cleaned up test event');
}
