/**
 * Reading JSON out of what a model actually sends. A local box without a
 * reasoning parser leaves `<think>…</think>` in the content, a chatty model
 * wraps the object in prose that itself has braces, and a model cut off
 * mid-thought leaves nothing — each of which used to be "the model did not
 * return JSON", which told the GM nothing about what to change.
 */
import { describe, expect, it } from 'vitest';
import { extractJsonObject, parseModelJson, stripThinking } from '../src/fixer/vision.js';

const PLAN = { title: 'Loading dock', rooms: [{ name: 'dock', x: 0, y: 0, w: 8, h: 6 }] };

describe('stripThinking', () => {
  it('removes a closed think block and says so', () => {
    expect(stripThinking('<think>let me plan {rooms}…</think>\n{"a":1}')).toEqual({ text: '{"a":1}', thought: true, unfinished: false });
  });
  it('drops an unclosed think block as unfinished', () => {
    expect(stripThinking('<think>still going and going')).toEqual({ text: '', thought: true, unfinished: true });
  });
  it('handles a closing tag whose opener went to the reasoning stream', () => {
    expect(stripThinking('…the rest of my reasoning</think>{"a":1}').text).toBe('{"a":1}');
  });
  it('leaves plain text alone', () => {
    expect(stripThinking('{"a":1}')).toEqual({ text: '{"a":1}', thought: false, unfinished: false });
  });
});

describe('extractJsonObject', () => {
  it('finds the object behind prose whose braces are not JSON', () => {
    const text = 'Here is the plan matching the schema {title, rooms}:\n' + JSON.stringify(PLAN) + '\nHope that helps!';
    expect(extractJsonObject(text)).toEqual(PLAN);
  });
  it('is not fooled by braces inside strings', () => {
    expect(extractJsonObject('x {"note":"a } inside","n":1} y')).toEqual({ note: 'a } inside', n: 1 });
  });
  it('answers null when nothing parses', () => {
    expect(extractJsonObject('{not json} and {still: not}')).toBeNull();
  });
});

describe('parseModelJson', () => {
  it('reads a think block followed by the object', () => {
    expect(parseModelJson(`<think>The dock needs a door {n}.</think>\n${JSON.stringify(PLAN)}`, 'the floor plan')).toEqual(PLAN);
  });
  it('reads a fenced object, and one wrapped in prose', () => {
    expect(parseModelJson('```json\n' + JSON.stringify(PLAN) + '\n```')).toEqual(PLAN);
    expect(parseModelJson('Sure — ' + JSON.stringify(PLAN) + ' Let me know.')).toEqual(PLAN);
  });
  it('tells the GM when the whole answer was thinking', () => {
    expect(() => parseModelJson('<think>hmm, a loading dock, 30 by 20', 'the floor plan')).toThrow(/spent its whole answer thinking.*Thinking to Off/);
    expect(() => parseModelJson('<think>done</think>', 'the floor plan')).toThrow(/spent its whole answer thinking/);
  });
  it('quotes what came back when it was simply not JSON', () => {
    expect(() => parseModelJson('I cannot draw maps, chummer.', 'the floor plan')).toThrow(/did not return JSON for the floor plan — it answered: “I cannot draw maps, chummer\.”/);
    expect(() => parseModelJson('   ', 'the floor plan')).toThrow(/returned nothing/);
  });
});
