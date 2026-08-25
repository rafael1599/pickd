import React from 'react';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import MousePointerClick from 'lucide-react/dist/esm/icons/mouse-pointer-click';
import Monitor from 'lucide-react/dist/esm/icons/monitor';
import type {
  ManualContent,
  ManualField,
  ManualSection,
  ManualStep,
  FaqItem,
} from '../../../content/manuals/types.ts';
import { ManualFigure } from './ManualFigure.tsx';

// The colour language, used consistently and explained by the legend:
//   emerald  a value to type character for character
//   dashed   a value that changes with the shipment
//   sky      something to click
//   red      what goes wrong if you get it wrong

const Value: React.FC<{ field: ManualField }> = ({ field }) => (
  <span className="inline-block font-mono text-xs font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-2 py-1 break-words">
    {field.value}
  </span>
);

const FieldRow: React.FC<{ field: ManualField }> = ({ field }) => (
  <div className="py-2 first:pt-0 last:pb-0 border-b border-subtle/60 last:border-b-0">
    <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
      <span className="text-[10px] font-black uppercase tracking-widest text-muted sm:w-44 sm:shrink-0 mb-1 sm:mb-0">
        {field.label}
      </span>
      <span className="min-w-0">
        <Value field={field} />
      </span>
    </div>
    {field.note && <p className="text-[11px] text-muted mt-1.5 sm:ml-[11.75rem]">{field.note}</p>}
  </div>
);

const Warning: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2.5">
    <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
    <p className="text-xs text-red-200 leading-relaxed">{text}</p>
  </div>
);

const StepBlock: React.FC<{ step: ManualStep; index: number; isLast: boolean }> = ({
  step,
  index,
  isLast,
}) => (
  <div className="flex gap-3">
    {/* Numbered rail — makes the order of a procedure visible at a glance. */}
    <div className="flex flex-col items-center shrink-0">
      <div className="w-7 h-7 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center">
        <span className="text-xs font-black text-accent">{index + 1}</span>
      </div>
      {!isLast && <div className="w-px flex-1 bg-subtle mt-1" />}
    </div>

    <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-6'}`}>
      <h3 className="text-sm font-bold text-content leading-snug">{step.title}</h3>

      {step.screen && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <Monitor size={11} className="text-muted shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted break-words">
            {step.screen}
          </span>
        </div>
      )}

      {step.body && <p className="text-sm text-content/85 leading-relaxed mt-2">{step.body}</p>}

      {step.imageUrl && (
        <div className="mt-3 overflow-hidden rounded-xl border border-subtle">
          <img src={step.imageUrl} alt={step.title} className="w-full object-cover" />
        </div>
      )}

      {step.videoUrl && (
        <div className="mt-3 overflow-hidden rounded-xl border border-subtle bg-black">
          <video
            src={step.videoUrl}
            autoPlay
            loop
            muted
            playsInline
            className="w-full object-cover"
          />
        </div>
      )}

      {step.fields.length > 0 && (
        <div className="mt-3 bg-card border border-subtle rounded-xl px-3 py-2">
          {step.fields.map((field, i) => (
            <FieldRow key={i} field={field} />
          ))}
        </div>
      )}

      {step.figures.map((figure, i) => (
        <ManualFigure key={i} figure={figure} />
      ))}

      {step.action && (
        <div className="flex items-center gap-2 mt-3">
          <MousePointerClick size={13} className="text-sky-400 shrink-0" />
          <span className="font-mono text-xs font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-md px-2 py-1 break-words">
            {step.action}
          </span>
        </div>
      )}

      {step.warning && (
        <div className="mt-3">
          <Warning text={step.warning} />
        </div>
      )}
    </div>
  </div>
);

/**
 * Reference: the rules and lookup tables at the back of a manual. Kept visually
 * quieter than the steps and placed after them, because it is read when
 * something has already gone wrong, not while walking the procedure.
 */
const ReferenceBlock: React.FC<{ section: ManualSection }> = ({ section }) => (
  <div className="mb-5 last:mb-0">
    <h3 className="text-sm font-bold text-content mb-2">{section.title}</h3>
    {section.body && <p className="text-sm text-content/85 leading-relaxed mb-2">{section.body}</p>}
    {section.bullets.length > 0 && (
      <ul className="mb-2 pl-5 space-y-1.5 list-disc marker:text-muted">
        {section.bullets.map((bullet, i) => (
          <li key={i} className="text-sm text-content/85 leading-relaxed">
            {bullet}
          </li>
        ))}
      </ul>
    )}
    {section.table && (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {section.table.headers.map((header) => (
                <th
                  key={header}
                  className="text-left text-[10px] font-black uppercase tracking-widest text-muted border-b border-subtle pb-1.5 pr-3 last:pr-0 align-bottom"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.table.rows.map((cells, i) => (
              <tr key={i}>
                {cells.map((cell, j) => (
                  <td
                    key={j}
                    className="text-xs text-content/85 leading-relaxed border-b border-subtle/60 py-2 pr-3 last:pr-0 align-top"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const FaqBlock: React.FC<{ faq: FaqItem }> = ({ faq }) => (
  <div className="mb-4 last:mb-0">
    <h4 className="text-sm font-bold text-content mb-1">{faq.question}</h4>
    <p className="text-sm text-content/85 leading-relaxed">{faq.answer}</p>
  </div>
);

export const ManualDocument: React.FC<{ content: ManualContent }> = ({ content }) => {
  if (
    content.steps.length === 0 &&
    content.warnings.length === 0 &&
    content.reference.length === 0 &&
    (!content.faqs || content.faqs.length === 0)
  ) {
    return <p className="text-sm text-muted italic">This manual has no steps recorded yet.</p>;
  }

  return (
    <div>
      {content.intro && (
        <p className="text-sm text-content/85 leading-relaxed mb-5">{content.intro}</p>
      )}

      <div>
        {content.steps.map((step, i) => (
          <StepBlock key={i} step={step} index={i} isLast={i === content.steps.length - 1} />
        ))}
      </div>

      {content.faqs && content.faqs.length > 0 && (
        <div className="mt-6 pt-5 border-t border-subtle">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-3">
            Preguntas Frecuentes
          </p>
          {content.faqs.map((faq, i) => (
            <FaqBlock key={i} faq={faq} />
          ))}
        </div>
      )}

      {content.reference.length > 0 && (
        <div className="mt-6 pt-5 border-t border-subtle">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-3">
            Reference
          </p>
          {content.reference.map((section, i) => (
            <ReferenceBlock key={i} section={section} />
          ))}
        </div>
      )}

      {content.warnings.length > 0 && (
        <div className="mt-6 pt-5 border-t border-subtle space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Always</p>
          {content.warnings.map((text, i) => (
            <Warning key={i} text={text} />
          ))}
        </div>
      )}
    </div>
  );
};
