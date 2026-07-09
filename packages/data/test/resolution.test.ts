import { describe, expect, it } from 'vitest'
import {
  levenshtein,
  nameSimilarity,
  resolveAccountDuplicates,
  resolveContactDuplicates,
} from '../src/resolution.js'

describe('levenshtein / nameSimilarity', () => {
  it('computes distances', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('same', 'same')).toBe(0)
  })
  it('similarity is 1 for identical, 0-ish for disjoint', () => {
    expect(nameSimilarity('acme', 'acme')).toBe(1)
    expect(nameSimilarity('acme', 'zzzz')).toBeLessThan(0.3)
  })
})

describe('resolveAccountDuplicates', () => {
  it('groups by normalized domain first (high confidence)', () => {
    const groups = resolveAccountDuplicates([
      { id: 'a', name: 'Acme Inc.', domain: 'https://www.acme.com/us' },
      { id: 'b', name: 'ACME Corporation', domain: 'acme.com' },
      { id: 'c', name: 'Other Co', domain: 'other.io' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ matchedOn: 'domain', confidence: 'high' })
    expect(groups[0]!.memberIds.sort()).toEqual(['a', 'b'])
  })

  it('falls back to normalized name when domains are absent', () => {
    const groups = resolveAccountDuplicates([
      { id: 'a', name: 'Acme Inc.', domain: null },
      { id: 'b', name: 'acme llc', domain: null },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ matchedOn: 'name', key: 'name:acme' })
  })

  it('fuzzy-matches near-identical names (low confidence)', () => {
    const groups = resolveAccountDuplicates([
      { id: 'a', name: 'Grainstorm Analytics', domain: null },
      { id: 'b', name: 'Grainstorm Analytic', domain: null },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ matchedOn: 'fuzzy', confidence: 'low' })
  })

  it('never groups same-named accounts with distinct valid domains', () => {
    // "Mercury" the bank vs "Mercury" the insurer: distinct domains = distinct identities
    expect(
      resolveAccountDuplicates([
        { id: 'a', name: 'Mercury', domain: 'mercury.com' },
        { id: 'b', name: 'Mercury', domain: 'mercuryinsurance.com' },
      ]),
    ).toHaveLength(0)
    expect(
      resolveAccountDuplicates([
        { id: 'a', name: 'Mercury Technologies', domain: 'mercury.com' },
        { id: 'b', name: 'Mercury Technology', domain: 'mercuryinsurance.com' }, // near-identical name, fuzzy tier
      ]),
    ).toHaveLength(0)
  })

  it('lets a domainless record name-match a domained one', () => {
    const groups = resolveAccountDuplicates([
      { id: 'a', name: 'Acme Inc.', domain: 'acme.com' },
      { id: 'b', name: 'Acme LLC', domain: null },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.memberIds.sort()).toEqual(['a', 'b'])
  })

  it('excludes protected records (Do_Not_Touch)', () => {
    const groups = resolveAccountDuplicates([
      { id: 'a', name: 'Acme', domain: 'acme.com', protected: true },
      { id: 'b', name: 'Acme', domain: 'acme.com' },
    ])
    expect(groups).toHaveLength(0)
  })
})

describe('resolveContactDuplicates', () => {
  it('linkedin exact beats email', () => {
    const groups = resolveContactDuplicates([
      { id: 'a', firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.com', linkedinUrl: 'https://linkedin.com/in/janedoe', companyName: 'Acme' },
      { id: 'b', firstName: 'J', lastName: 'Doe', email: 'j.doe@acme.com', linkedinUrl: 'linkedin.com/in/JaneDoe/', companyName: 'Acme Inc' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ matchedOn: 'linkedin', confidence: 'high' })
  })

  it('groups by lowercased email when no linkedin', () => {
    const groups = resolveContactDuplicates([
      { id: 'a', firstName: 'Jane', lastName: 'Doe', email: 'Jane@Acme.com', linkedinUrl: null, companyName: null },
      { id: 'b', firstName: 'Jane', lastName: 'D', email: 'jane@acme.com', linkedinUrl: null, companyName: null },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ matchedOn: 'email' })
  })

  it('fuzzy name+company fallback only when identifiers are missing', () => {
    const groups = resolveContactDuplicates([
      { id: 'a', firstName: 'Jane', lastName: 'Doe', email: null, linkedinUrl: null, companyName: 'Acme Inc.' },
      { id: 'b', firstName: 'Jane', lastName: 'Doe', email: null, linkedinUrl: null, companyName: 'Acme LLC' },
      { id: 'c', firstName: 'Bob', lastName: 'Smith', email: null, linkedinUrl: null, companyName: 'Other' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.memberIds.sort()).toEqual(['a', 'b'])
    expect(groups[0]).toMatchObject({ matchedOn: 'fuzzy', confidence: 'low' })
  })
})
