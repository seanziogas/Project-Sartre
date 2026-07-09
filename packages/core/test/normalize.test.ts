import { describe, expect, it } from 'vitest'
import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
} from '../src/canonical/normalize.js'

// Cases from the cxt_hub dedup standards table, plus edge cases.
describe('normalizeDomain', () => {
  it('strips protocol, www, paths, and country subpaths', () => {
    expect(normalizeDomain('https://www.Example.com/us/')).toBe('example.com')
    expect(normalizeDomain('example.com/us')).toBe('example.com')
    expect(normalizeDomain('WWW.EXAMPLE.COM')).toBe('example.com')
    expect(normalizeDomain('http://sub.example.co.uk/path?q=1')).toBe('sub.example.co.uk')
  })
  it('tolerates emails pasted into domain columns', () => {
    expect(normalizeDomain('jane@acme.io')).toBe('acme.io')
  })
  it('rejects non-domains', () => {
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain('   ')).toBeNull()
    expect(normalizeDomain('not a domain')).toBeNull()
    expect(normalizeDomain('localhost')).toBeNull()
  })
})

describe('normalizeCompanyName', () => {
  it('strips legal suffixes and lowercases (Acme Inc. → acme)', () => {
    expect(normalizeCompanyName('Acme Inc.')).toBe('acme')
    expect(normalizeCompanyName('Acme, LLC')).toBe('acme')
    expect(normalizeCompanyName('ACME CORP')).toBe('acme')
  })
  it('strips stacked suffixes', () => {
    expect(normalizeCompanyName('Acme Holdings Ltd.')).toBe('acme')
  })
  it('keeps names that ARE a suffix word', () => {
    expect(normalizeCompanyName('Limited')).toBe('limited')
  })
  it('rejects empty', () => {
    expect(normalizeCompanyName('  ')).toBeNull()
  })
})

describe('normalizeEmail', () => {
  it('lowercases', () => {
    expect(normalizeEmail(' Jane.Doe@Acme.IO ')).toBe('jane.doe@acme.io')
  })
  it('rejects malformed', () => {
    expect(normalizeEmail('jane@acme')).toBeNull()
    expect(normalizeEmail('not-an-email')).toBeNull()
  })
})

describe('normalizeLinkedinUrl', () => {
  it('canonicalizes to host+path', () => {
    expect(normalizeLinkedinUrl('https://www.linkedin.com/in/Jane-Doe/')).toBe('linkedin.com/in/jane-doe')
    expect(normalizeLinkedinUrl('linkedin.com/company/acme?trk=x')).toBe('linkedin.com/company/acme')
  })
  it('rejects non-linkedin urls', () => {
    expect(normalizeLinkedinUrl('https://twitter.com/acme')).toBeNull()
  })
})
