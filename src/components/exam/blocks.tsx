'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { safeHtml } from '@/lib/exams/html';

/**
 * The objective task types, drawn from the paper's own content (the telc
 * layouts). Every one reads the same answers map, keyed by the item's
 * number through the paper, and reports a change with onAnswer; whether
 * the change is taken is the server's business.
 */

export type Answers = Record<string, string | null | undefined>;

export interface Item {
  n: number;
  no: number;
  i?: number;
  q?: string;
  opts?: { k: string; t?: string; h?: string }[];
}

export interface Block {
  id: string;
  layout: string;
  title: string;
  items?: Item[];
  [content: string]: unknown;
}

export interface BlockProps {
  block: Block;
  answers: Answers;
  onAnswer: (n: number, value: string | null, typed?: boolean) => void;
  disabled: boolean;
  flags: Set<number>;
  toggleFlag: (n: number) => void;
  language: 'de' | 'en';
  /** Above the items for listening blocks. */
  player?: ReactNode;
}

const L = {
  de: { true: 'richtig', false: 'falsch', none: 'Keine Anzeige passt', noneText: 'Wählen Sie x, wenn zu der Situation keines der Angebote passt.', headings: 'Überschriften', words: 'Wörter', choices: 'Auswahl', ads: 'Anzeigen', flag: 'Zur späteren Prüfung markieren', taken: 'steht schon bei Aufgabe', typed: 'Ihre Eingabe' },
  en: { true: 'true', false: 'false', none: 'None fits', noneText: 'Choose x when none of them fits.', headings: 'Headings', words: 'Words', choices: 'Choices', ads: 'Adverts', flag: 'Mark to come back to', taken: 'already given to question', typed: 'Your answer' },
};

const html = (s: unknown) => ({ __html: safeHtml(s) });

/** Letters that belong to one question only (a heading, an advert, a word): choosing one elsewhere moves it. */
export function exclusive(block: Block): boolean {
  if (!['match', 'clozeBank', 'audioMatch', 'ads'].includes(block.layout)) return false;
  const questions = (block.items ?? []).length;
  const choices = block.layout === 'ads' ? ((block.ads as unknown[]) ?? []).length : ((block.bank as unknown[]) ?? []).length;
  return questions > 0 && choices >= questions;
}

function ItemShell({ it, children, answered, props }: { it: Item; children: ReactNode; answered: boolean; props: BlockProps }) {
  const w = L[props.language];
  const flagged = props.flags.has(it.n);
  return (
    <div className={`exam-item ${answered ? 'answered' : ''} ${flagged ? 'flagged' : ''}`} id={`item-${it.n}`}>
      <div className="exam-item-top">
        <span className="exam-item-no">{it.no}</span>
        {it.q ? <div className="exam-item-q" dangerouslySetInnerHTML={html(it.q)} /> : <div className="flex-1" />}
        <button type="button" className={`exam-flag ${flagged ? 'on' : ''}`} onClick={() => props.toggleFlag(it.n)} title={w.flag} aria-label={`${w.flag}: ${it.no}`} aria-pressed={flagged}>
          ⚑
        </button>
      </div>
      {children}
    </div>
  );
}

function Options({ it, props, options }: { it: Item; props: BlockProps; options: { k: string; label: ReactNode }[] }) {
  const chosen = props.answers[String(it.n)];
  return (
    <div className="exam-opts" role="radiogroup" aria-label={`${it.no}`}>
      {options.map((o) => (
        <label key={o.k} className={`exam-opt ${chosen === o.k ? 'sel' : ''}`}>
          <input type="radio" name={`q${it.n}`} value={o.k} checked={chosen === o.k} disabled={props.disabled} onChange={() => props.onAnswer(it.n, o.k)} />
          <span className="k">{o.k}</span>
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function optionList(it: Item) {
  return (it.opts ?? []).map((o) => ({ k: o.k, label: <span dangerouslySetInnerHTML={html(o.t ?? o.h)} /> }));
}

function TrueFalse({ it, props }: { it: Item; props: BlockProps }) {
  const w = L[props.language];
  return <Options it={it} props={props} options={[{ k: 'r', label: `+ ${w.true}` }, { k: 'f', label: `− ${w.false}` }]} />;
}

function PickRow({ it, keys, props }: { it: Item; keys: string[]; props: BlockProps }) {
  const w = L[props.language];
  const mine = props.answers[String(it.n)];
  const only = exclusive(props.block);
  return (
    <div className="exam-picks" role="radiogroup" aria-label={`${it.no}`}>
      {keys.map((k) => {
        const holder = only && k !== 'x' && mine !== k ? (props.block.items ?? []).find((o) => o.n !== it.n && props.answers[String(o.n)] === k) : undefined;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={mine === k}
            disabled={props.disabled}
            className={`exam-pick ${mine === k ? 'sel' : ''} ${holder ? 'taken' : ''}`}
            title={holder ? `${w.taken} ${holder.no}` : undefined}
            onClick={() => props.onAnswer(it.n, mine === k ? null : k)}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}

function Bank({ title, bank, used, grid }: { title: string; bank: { k: string; t: string }[]; used: Set<string>; grid?: boolean }) {
  return (
    <div className="exam-bank">
      <h4>{title}</h4>
      <ul className={grid ? 'grid' : ''}>
        {bank.map((b) => (
          <li key={b.k} className={used.has(b.k) ? 'used' : ''}>
            <span className="k">{b.k}</span>
            <span dangerouslySetInnerHTML={html(b.t)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TypedField({ n, label, props, wide }: { n: number; label: string; props: BlockProps; wide?: boolean }) {
  const saved = props.answers[String(n)] ?? '';
  const [value, setValue] = useState(saved);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setValue(saved);
  }, [saved]);
  return (
    <input
      className={`exam-typed ${wide ? 'wide' : ''}`}
      type="text"
      value={value}
      disabled={props.disabled}
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        props.onAnswer(n, value.trim() ? value : null);
      }}
      onChange={(e) => {
        setValue(e.target.value);
        props.onAnswer(n, e.target.value.trim() ? e.target.value : null, true);
      }}
    />
  );
}

function Gap({ n, label, filled }: { n: number; label: string; filled: boolean }) {
  return (
    <a href={`#item-${n}`} className={`exam-gap ${filled ? 'filled' : ''}`}>
      {label}
    </a>
  );
}

function Letter({ letter, render }: { letter: { title: string; lines: string[] }; render: (n: number) => ReactNode }) {
  return (
    <div className="exam-reading">
      <h3 dangerouslySetInnerHTML={html(letter.title)} />
      {letter.lines.map((line, i) => (
        <p key={i}>
          {line.split(/(\[\[\d+\]\])/).map((part, j) => {
            const m = part.match(/^\[\[(\d+)\]\]$/);
            return m ? <span key={j}>{render(Number(m[1]))}</span> : <span key={j} dangerouslySetInnerHTML={html(part)} />;
          })}
        </p>
      ))}
    </div>
  );
}

const answered = (a: Answers, n: number) => {
  const v = a[String(n)];
  return v != null && String(v).trim() !== '';
};

export function ObjectiveBlock(props: BlockProps) {
  const b = props.block;
  const items = b.items ?? [];
  const w = L[props.language];
  const used = new Set(items.map((i) => props.answers[String(i.n)]).filter((x): x is string => Boolean(x)));
  const list = (render: (it: Item) => ReactNode) => (
    <div className="exam-items">
      {items.map((it) => (
        <ItemShell key={it.n} it={it} answered={answered(props.answers, it.n)} props={props}>
          {render(it)}
        </ItemShell>
      ))}
    </div>
  );

  switch (b.layout) {
    case 'match': {
      const bank = b.bank as { k: string; t: string }[];
      const texts = b.texts as { tag: string; body: string }[];
      return (
        <div className="exam-split">
          <div className="exam-reading flat">
            {texts.map((t) => (
              <div key={t.tag} className="exam-minitext">
                <span className="tag">{t.tag}</span>
                <p dangerouslySetInnerHTML={html(t.body)} />
              </div>
            ))}
          </div>
          <div>
            <Bank title={w.headings} bank={bank} used={used} />
            {list((it) => <PickRow it={it} keys={bank.map((x) => x.k)} props={props} />)}
          </div>
        </div>
      );
    }
    case 'mc': {
      const a = b.article as { title: string; src?: string; paras: string[] };
      return (
        <div className="exam-split">
          <div className="exam-reading">
            <h3 dangerouslySetInnerHTML={html(a.title)} />
            {a.src && <div className="src" dangerouslySetInnerHTML={html(a.src)} />}
            {a.paras.map((p, i) => (
              <p key={i} dangerouslySetInnerHTML={html(p)} />
            ))}
          </div>
          {list((it) => <Options it={it} props={props} options={optionList(it)} />)}
        </div>
      );
    }
    case 'ads': {
      const ads = b.ads as { k: string; h: string; t: string }[];
      return (
        <div className="exam-split">
          <div className="exam-reading">
            <h4 className="exam-subhead">
              {w.ads} a–{ads[ads.length - 1]?.k}
            </h4>
            {ads.map((a) => (
              <div key={a.k} className="exam-ad">
                <span className="k">{a.k}</span>
                <h5 dangerouslySetInnerHTML={html(a.h)} />
                <p dangerouslySetInnerHTML={html(a.t)} />
              </div>
            ))}
            <div className="exam-ad dashed">
              <span className="k">x</span>
              <h5>{w.none}</h5>
              <p>{w.noneText}</p>
            </div>
          </div>
          {list((it) => <PickRow it={it} keys={[...ads.map((a) => a.k), 'x']} props={props} />)}
        </div>
      );
    }
    case 'cloze3': {
      const letter = b.letter as { title: string; lines: string[] };
      return (
        <div className="exam-split">
          <Letter
            letter={letter}
            render={(n) => {
              const it = items.find((x) => x.n === n);
              const a = props.answers[String(n)];
              const label = a ? (it?.opts?.find((o) => o.k === a)?.t ?? String(it?.no ?? n)) : String(it?.no ?? n);
              return <Gap n={n} label={label} filled={Boolean(a)} />;
            }}
          />
          {list((it) => <Options it={it} props={props} options={optionList(it)} />)}
        </div>
      );
    }
    case 'clozeBank': {
      const letter = b.letter as { title: string; lines: string[] };
      const bank = b.bank as { k: string; t: string }[];
      return (
        <div className="exam-split">
          <Letter
            letter={letter}
            render={(n) => {
              const it = items.find((x) => x.n === n);
              const a = props.answers[String(n)];
              return <Gap n={n} label={a ? (bank.find((x) => x.k === a)?.t ?? a) : String(it?.no ?? n)} filled={Boolean(a)} />;
            }}
          />
          <div>
            <Bank title={`${w.words} a–${bank[bank.length - 1]?.k}`} bank={bank} used={used} grid />
            {list((it) => <PickRow it={it} keys={bank.map((x) => x.k)} props={props} />)}
          </div>
        </div>
      );
    }
    case 'audioRF':
      return (
        <>
          {props.player}
          {list((it) => <TrueFalse it={it} props={props} />)}
        </>
      );
    case 'audioMC':
      return (
        <>
          {props.player}
          {typeof b.hinweis === 'string' && <div className="exam-note" dangerouslySetInnerHTML={html(b.hinweis)} />}
          {list((it) => <Options it={it} props={props} options={optionList(it)} />)}
        </>
      );
    case 'audioNotiz': {
      const note = b.notiz as { title: string; lines: string[] };
      return (
        <>
          {props.player}
          <div className="exam-split">
            <div className="exam-note-paper">
              <div className="head" dangerouslySetInnerHTML={html(note.title)} />
              {note.lines.map((line, i) => (
                <div key={i} className="line">
                  {line.split(/(\[\[\d+\]\])/).map((part, j) => {
                    const m = part.match(/^\[\[(\d+)\]\]$/);
                    if (!m) return <span key={j} dangerouslySetInnerHTML={html(part)} />;
                    const n = Number(m[1]);
                    const it = items.find((x) => x.n === n);
                    return (
                      <span key={j} className="whitespace-nowrap">
                        <TypedField n={n} label={`${it?.no ?? n}`} props={props} />
                        <sup className="exam-typed-no">{it?.no ?? n}</sup>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
            {list((it) => <TypedField n={it.n} label={`${it.no}`} props={props} wide />)}
          </div>
        </>
      );
    }
    case 'audioMatch': {
      const bank = b.bank as { k: string; t: string }[];
      return (
        <>
          {props.player}
          <div className="exam-split">
            <Bank title={(b.bankTitle as string) || w.choices} bank={bank} used={used} />
            {list((it) => <PickRow it={it} keys={bank.map((x) => x.k)} props={props} />)}
          </div>
        </>
      );
    }
    case 'textRF': {
      const texts = (b.texte as { tag: string; title?: string; body: string }[]) ?? [];
      return (
        <div className="exam-split">
          <div className="exam-reading flat">
            {texts.map((t, i) => (
              <div key={i} className="exam-minitext">
                <span className="tag">{t.tag}</span>
                {t.title && <h5 dangerouslySetInnerHTML={html(t.title)} />}
                <p dangerouslySetInnerHTML={html(t.body)} />
              </div>
            ))}
          </div>
          {list((it) => <TrueFalse it={it} props={props} />)}
        </div>
      );
    }
    case 'infoMC': {
      const board = b.tafel as { title: string; rows: string[][] };
      return (
        <div className="exam-split">
          <div className="exam-board">
            <div className="head" dangerouslySetInnerHTML={html(board.title)} />
            {board.rows.map((r, i) => (
              <div key={i} className="row">
                <span className="k" dangerouslySetInnerHTML={html(r[0])} />
                <span dangerouslySetInnerHTML={html(r[1])} />
              </div>
            ))}
          </div>
          {list((it) => <Options it={it} props={props} options={optionList(it)} />)}
        </div>
      );
    }
    case 'adsAB':
      return (
        <div className="exam-items wide">
          {items.map((it) => (
            <ItemShell key={it.n} it={it} answered={answered(props.answers, it.n)} props={props}>
              <div className="exam-abpair" role="radiogroup">
                {(it.opts ?? []).map((o) => (
                  <label key={o.k} className={`exam-abcard ${props.answers[String(it.n)] === o.k ? 'sel' : ''}`}>
                    <input type="radio" name={`q${it.n}`} value={o.k} disabled={props.disabled} checked={props.answers[String(it.n)] === o.k} onChange={() => props.onAnswer(it.n, o.k)} />
                    <span className="k">{o.k}</span>
                    <span>
                      <b dangerouslySetInnerHTML={html(o.h)} /> <span dangerouslySetInnerHTML={html(o.t)} />
                    </span>
                  </label>
                ))}
              </div>
            </ItemShell>
          ))}
        </div>
      );
    case 'formular': {
      const source = b.quelle as { tag: string; body: string };
      const form = b.formular as { title: string; rows: (string | number | null)[][] };
      return (
        <div className="exam-split">
          <div className="exam-reading flat">
            <div className="exam-minitext">
              <span className="tag">{source.tag}</span>
              <p dangerouslySetInnerHTML={html(source.body)} />
            </div>
          </div>
          <div className="exam-form">
            <div className="head" dangerouslySetInnerHTML={html(form.title)} />
            {form.rows.map((r, i) => {
              if (r[1] === null) {
                const n = Number(r[2]);
                const it = items.find((x) => x.n === n);
                return (
                  <div key={i} id={`item-${n}`} className={`row gap ${answered(props.answers, n) ? 'answered' : ''}`}>
                    <span className="l" dangerouslySetInnerHTML={html(r[0])} />
                    <span className="v">
                      <TypedField n={n} label={String(it?.no ?? n)} props={props} />
                      <sup className="exam-typed-no">{it?.no ?? n}</sup>
                    </span>
                  </div>
                );
              }
              return (
                <div key={i} className="row">
                  <span className="l" dangerouslySetInnerHTML={html(r[0])} />
                  <span className="v given" dangerouslySetInnerHTML={html(r[1])} />
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
