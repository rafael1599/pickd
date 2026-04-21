/**
 * Per-project (per-task) PDF document — single A4 page.
 *
 * Same visual language as the Activity Report PDF (warm paper, teal
 * accent, Inter + JB Mono, corner marks) so the two feel like the same
 * report family. Content is focused: task header, optional note, full
 * photo grid. No KPIs, no activity board.
 *
 * If a task has more photos than fit on one page, they spill onto
 * additional pages — react-pdf handles the flex-wrap break automatically.
 */

import { Document, Page, View, Text, Image } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { registerPdfFonts } from '../../../lib/pdf/fonts';
import { TONE, SANS, MONO, A4, A4_MARGIN, pickCols, formatDateLong } from '../../../lib/pdf/tokens';
import { Step, CornerMarks } from '../../../lib/pdf/primitives';

registerPdfFonts();

export interface TaskPdfDocProps {
  task: {
    id: string;
    title: string;
    note: string | null;
    status: 'future' | 'in_progress' | 'done';
  };
  /** Full-size photo URLs (already transcoded to data URLs). */
  photoUrls: string[];
  /** YYYY-MM-DD — shown in the header as the export date. */
  exportDate: string;
}

const STATUS_LABEL: Record<TaskPdfDocProps['task']['status'], string> = {
  future: 'COMING UP',
  in_progress: 'IN PROGRESS',
  done: 'DONE',
};

const STATUS_COLOR: Record<TaskPdfDocProps['task']['status'], string> = {
  future: TONE.muted,
  in_progress: TONE.amber,
  done: TONE.teal,
};

export function TaskPdfDoc({ task, photoUrls, exportDate }: TaskPdfDocProps): ReactNode {
  const cols = pickCols(photoUrls.length);
  const contentW = A4.w - A4_MARGIN * 2;
  const gap = 6;
  const tileSize = (contentW - gap * (cols - 1)) / cols;
  const accent = STATUS_COLOR[task.status];

  return (
    <Document>
      <Page
        size="A4"
        style={{
          backgroundColor: TONE.paperWarm,
          padding: A4_MARGIN,
          fontFamily: SANS,
          color: TONE.ink,
        }}
      >
        {/* Top edge band */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 5,
            backgroundColor: accent,
          }}
        />
        <CornerMarks color={accent} />

        {/* HEADER */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderBottomColor: TONE.hair,
          }}
        >
          <View>
            <Text
              style={{
                fontSize: 9,
                letterSpacing: 2,
                color: TONE.muted,
                fontWeight: 500,
                marginBottom: 6,
              }}
            >
              PICKD · PROJECT REPORT
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Step n="01" color={accent} size={20} />
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: -0.4,
                  marginLeft: 10,
                  lineHeight: 1,
                }}
              >
                {task.title}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View
              style={{
                backgroundColor: accent,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 2,
                marginBottom: 4,
              }}
            >
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 8,
                  fontWeight: 600,
                  color: '#ffffff',
                  letterSpacing: 1.2,
                }}
              >
                {STATUS_LABEL[task.status]}
              </Text>
            </View>
            <Text
              style={{
                fontFamily: SANS,
                fontSize: 11,
                fontWeight: 500,
                color: TONE.ink,
              }}
            >
              {formatDateLong(exportDate)}
            </Text>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 8,
                color: TONE.muted,
                marginTop: 2,
              }}
            >
              {photoUrls.length} PHOTO{photoUrls.length !== 1 ? 'S' : ''}
            </Text>
          </View>
        </View>

        {/* NOTE (optional) */}
        {task.note && task.note.trim().length > 0 && (
          <View
            style={{
              marginTop: 14,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: TONE.hair,
              borderLeftWidth: 3,
              borderLeftColor: accent,
              borderRadius: 2,
              backgroundColor: TONE.paperPure,
            }}
          >
            <Text
              style={{
                fontSize: 11.5,
                color: TONE.ink,
                lineHeight: 1.4,
                letterSpacing: -0.15,
              }}
            >
              {task.note}
            </Text>
          </View>
        )}

        {/* PHOTOS */}
        {photoUrls.length === 0 ? (
          <View
            style={{
              marginTop: 20,
              paddingVertical: 40,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: TONE.hair,
              borderStyle: 'dashed',
              borderRadius: 3,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                color: TONE.muted,
                fontWeight: 500,
              }}
            >
              No photos yet.
            </Text>
          </View>
        ) : (
          <View
            style={{
              marginTop: 14,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap,
            }}
          >
            {photoUrls.map((url, i) => (
              <View
                key={i}
                style={{
                  width: tileSize,
                  height: tileSize,
                  borderRadius: 2,
                  overflow: 'hidden',
                  backgroundColor: TONE.hair,
                }}
                wrap={false}
              >
                <Image
                  src={url}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              </View>
            ))}
          </View>
        )}

        {/* FOOTER */}
        <View
          style={{
            position: 'absolute',
            bottom: A4_MARGIN,
            left: A4_MARGIN,
            right: A4_MARGIN,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: TONE.hair,
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.muted }}>
            GENERATED BY PICKD ·{' '}
            {new Date()
              .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              .toUpperCase()}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.muted }}>
            TASK · {task.id.slice(0, 8).toUpperCase()}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
