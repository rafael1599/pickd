import React from 'react';
import type { Figure, FigureMark, FigureRow } from '../../../content/manuals/types.ts';

/**
 * A simplified picture of a window in the other system.
 *
 * It beats a list of field names because of how the picture is actually used:
 * an operator holds it next to the real screen and looks for the shape. Labels
 * are read second, if at all — so the marked control is *ringed*, not just
 * described, and the window keeps the application's own colours rather than
 * PickD's.
 *
 * Every colour here is hard-coded rather than themed, for the same reason. This
 * is a picture of somebody else's software; it looks the same in dark mode
 * because the software does. That makes it the one place in the app where
 * ui-rules §10 bites hardest — a light surface inside a `dark` root — so every
 * single text node below carries an explicit colour. Inheriting here means
 * white on white.
 */

const INK = 'text-[#1a1a1a]';
const MUTED = 'text-[#4a4a4a]';
const ORANGE = 'text-[#c2410c]';

const RING = 'ring-2 ring-[#e8730c] ring-offset-0';

/** The "◄ ❶ do this" that hangs off a control. */
const Mark: React.FC<{ mark: FigureMark }> = ({ mark }) => (
  <span className={`inline-flex items-baseline gap-1 ${ORANGE} text-[10px] font-bold shrink-0`}>
    <span aria-hidden="true">◄</span>
    {mark.n !== undefined && (
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#e8730c] text-white text-[8px] font-black not-italic self-center">
        {mark.n}
      </span>
    )}
    <span>{mark.text}</span>
  </span>
);

/** Wraps a control with its mark, so highlight and label never drift apart. */
const Marked: React.FC<{ mark?: FigureMark; children: React.ReactNode }> = ({ mark, children }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    <span className={mark ? `inline-block rounded-[2px] ${RING}` : 'inline-block'}>{children}</span>
    {mark && <Mark mark={mark} />}
  </span>
);

const Input: React.FC<{ value: string; dropdown?: boolean; wide?: boolean }> = ({
  value,
  dropdown,
  wide,
}) => (
  <span
    className={`inline-flex items-center justify-between gap-2 bg-white border border-[#8a8a8a] px-1.5 py-0.5 font-mono text-[10px] ${INK} ${
      wide ? 'min-w-[10rem]' : 'min-w-[4rem]'
    }`}
  >
    <span className="truncate">{value}</span>
    {dropdown && <span className={`text-[8px] ${MUTED}`}>▼</span>}
  </span>
);

const Button: React.FC<{ label: string }> = ({ label }) => (
  <span
    className={`inline-block bg-[#e0e0e0] border border-[#8a8a8a] px-2.5 py-0.5 text-[10px] font-medium ${INK}`}
  >
    {label}
  </span>
);

const Row: React.FC<{ row: FigureRow }> = ({ row }) => {
  switch (row.kind) {
    case 'menubar':
      return (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {row.items.map((item) => {
            const isActive = item === row.active;
            const chip = (
              <span
                className={`px-1.5 py-0.5 text-[10px] ${INK} ${isActive ? 'bg-[#fde3c7]' : ''}`}
              >
                {item}
              </span>
            );
            return isActive ? (
              <Marked key={item} mark={row.mark}>
                {chip}
              </Marked>
            ) : (
              <React.Fragment key={item}>{chip}</React.Fragment>
            );
          })}
        </div>
      );

    case 'menu':
      return (
        <div className="flex items-start gap-1.5" style={{ paddingLeft: `${row.indent * 1.5}rem` }}>
          <span className="inline-block bg-white border border-[#8a8a8a] py-0.5 min-w-[8rem]">
            {row.items.map((item) => {
              const isActive = item === row.active;
              return (
                <span
                  key={item}
                  className={`block px-2 py-0.5 text-[10px] ${
                    isActive ? `bg-[#fde3c7] ${INK}` : INK
                  }`}
                >
                  {item}
                </span>
              );
            })}
          </span>
          {row.mark && <Mark mark={row.mark} />}
        </div>
      );

    case 'field':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-medium ${INK} shrink-0`}>{row.label}:</span>
          <Marked mark={row.mark}>
            <span className="inline-flex items-center gap-1.5">
              <Input value={row.value} dropdown={row.input === 'dropdown'} wide />
              {row.button && <Button label={row.button} />}
            </span>
          </Marked>
        </div>
      );

    case 'choice':
      return (
        <div>
          {row.label && <p className={`text-[10px] font-bold ${INK} mb-1`}>{row.label}</p>}
          <div className="space-y-1">
            {row.options.map((option) => (
              <div key={option.label}>
                <Marked mark={option.mark}>
                  <span className="inline-flex items-center gap-1.5 px-0.5">
                    <span className="inline-flex items-center justify-center w-2.5 h-2.5 rounded-full border border-[#5a5a5a] bg-white shrink-0">
                      {option.selected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#1a1a1a]" />
                      )}
                    </span>
                    <span className={`text-[10px] ${INK}`}>{option.label}</span>
                  </span>
                </Marked>
              </div>
            ))}
          </div>
        </div>
      );

    case 'checkbox':
      return (
        <Marked mark={row.mark}>
          <span className="inline-flex items-center gap-1.5 px-0.5">
            <span className="inline-flex items-center justify-center w-2.5 h-2.5 border border-[#5a5a5a] bg-white text-[8px] leading-none shrink-0">
              {row.checked ? <span className={INK}>✓</span> : null}
            </span>
            <span className={`text-[10px] ${INK}`}>{row.label}</span>
          </span>
        </Marked>
      );

    case 'buttons':
      return (
        <div className="flex flex-wrap items-center gap-2">
          {row.items.map((item) => (
            <Marked key={item.label} mark={item.mark}>
              <Button label={item.label} />
            </Marked>
          ))}
        </div>
      );

    case 'readout':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-medium ${INK} shrink-0`}>{row.label}:</span>
          <Marked mark={row.mark}>
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              {row.items.map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1">
                  <span className={`text-[10px] ${INK}`}>{item.label}</span>
                  <Input value={item.value} />
                </span>
              ))}
            </span>
          </Marked>
        </div>
      );

    case 'table':
      return (
        <div>
          <div className="overflow-x-auto">
            <table className="border-collapse">
              <thead>
                <tr>
                  {row.headers.map((header) => (
                    <th
                      key={header}
                      className="bg-[#4c2a85] text-white text-[10px] font-bold text-left px-2 py-1 border border-[#3a1f66] whitespace-nowrap"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {row.rows.map((cells, i) => (
                  <tr key={i}>
                    {cells.map((cell, j) => (
                      <td
                        key={j}
                        className={`bg-white border border-[#b0b0b0] px-2 py-1 text-[10px] ${INK} whitespace-nowrap`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {row.mark && (
            <div className="mt-1">
              <Mark mark={row.mark} />
            </div>
          )}
        </div>
      );
  }
};

export const ManualFigure: React.FC<{ figure: Figure }> = ({ figure }) => (
  <figure className="my-3">
    {figure.caption && (
      <figcaption className="text-[10px] font-black uppercase tracking-widest text-muted mb-1.5">
        {figure.caption}
      </figcaption>
    )}
    {/* The window itself. `overflow-x-auto` because a reproduced desktop dialog
        is wider than a phone and must scroll inside its own box, never push the
        page sideways (ui-rules §responsive). */}
    <div className="border border-[#9a9a9a] rounded-sm overflow-hidden bg-[#ededed]">
      <div className="bg-[#4c2a85] px-2 py-1">
        <span className="text-[10px] font-bold text-white">{figure.title}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="p-2.5 space-y-2 min-w-min">
          {figure.rows.map((row, i) => (
            <Row key={i} row={row} />
          ))}
        </div>
      </div>
    </div>
  </figure>
);
