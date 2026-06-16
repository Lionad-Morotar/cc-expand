import { describe, it, expect } from 'vitest'
import { classifyDesc } from '../../src/services/desc-classifier.js'

describe('classifyDesc', () => {
  it('识别 exceeds200k 阈值(裸串与带前缀)', () => {
    expect(classifyDesc('>200000:!1}')).toBe('exceeds200k threshold')
    expect(classifyDesc('K)>200000:!1}')).toBe('exceeds200k threshold')
  })

  it('识别 teamMemorySync (伴生 1536)', () => {
    expect(classifyDesc('Pw3=200000,Ww3=1536,OB8=20')).toBe('teamMemorySync')
  })

  it('识别 MAX_TOOL_RESULTS_PER_MESSAGE (伴生 50)', () => {
    expect(classifyDesc('YS7=200000,Gk=50,AS7=1e4')).toBe('MAX_TOOL_RESULTS_PER_MESSAGE')
  })

  it('识别 MODEL_CONTEXT_WINDOW_DEFAULT (独立 =20000 伴生)', () => {
    expect(classifyDesc('_Z_=200000,ct=200000,qZ_=20000')).toBe('MODEL_CONTEXT_WINDOW_DEFAULT')
    expect(classifyDesc('AP_=200000,YP_=20000')).toBe('MODEL_CONTEXT_WINDOW_DEFAULT')
  })

  it('不把 200000 误判为 MODEL(20000 是 200000 前缀子串的回归保护)', () => {
    // skill tool budget:含 =200000 但无独立 =20000,应兜底 generic 而非 MODEL
    expect(classifyDesc('gVO=200000,NOq=3,bm6=2')).toBe('context-window-limit')
  })
})
