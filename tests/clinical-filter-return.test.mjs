import assert from 'node:assert/strict';
import test from 'node:test';
import { realListingModule } from './helpers/clinical-form-submit.mjs';

const { clinicalFilterCarrier } = await realListingModule();

test('RED (a) clinical filter carrier keeps valid list filters under their plain names and ignores list coordinates', () => {
  const params = new URLSearchParams('status=draft&date_from=2026-01-01&date_to=2026-02-01&evaluation_id=7&list_limit=7&list_offset=14&limit=3&offset=6');
  assert.deepEqual(clinicalFilterCarrier(params), { status: 'draft', date_from: '2026-01-01', date_to: '2026-02-01', evaluation_id: '7' });
});

test('RED (a) clinical filter carrier returns nothing without filters', () => {
  assert.deepEqual(clinicalFilterCarrier(new URLSearchParams('list_limit=7&assignment_id=17')), {});
});

test('RED (a) clinical filter carrier drops every filter when any value is invalid, reversed, duplicated or structured, without throwing', () => {
  const invalid = [
    'status=archived',
    'status=draft&status=validated',
    'status[0]=draft',
    'date_from=2026-13-01',
    'date_from=2026-02-01&date_to=2026-01-01',
    'evaluation_id=0',
    'evaluation_id=abc',
    'evaluation_id=7&evaluation_id=8',
    'status=draft&evaluation_id=0',
  ];
  for (const query of invalid) {
    assert.doesNotThrow(() => clinicalFilterCarrier(new URLSearchParams(query)), query);
    assert.deepEqual(clinicalFilterCarrier(new URLSearchParams(query)), {}, query);
  }
});
