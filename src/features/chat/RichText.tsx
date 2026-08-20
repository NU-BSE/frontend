import React from 'react';

import { Text } from '@/components/Text';
import { fontFamily } from '@/theme/tokens';

import { parseInlineBold } from './inlineMarkdown';

/**
 * `**bold**` spans for message text.
 *
 * Returns runs meant to sit inside an existing <Text>, rather than wrapping
 * one, so a caller can keep appending its own children — the streaming caret
 * has to stay inside the same <Text> to flow with the last line instead of
 * jumping to its own.
 *
 * Emphasis is a font-family swap to the loaded Lora bold face, never a
 * `fontWeight`; see the note in inlineMarkdown.ts. Nested <Text> inherits size
 * and colour from the parent, so only the face changes.
 */
export function InlineBold({ children }: { children: string }) {
  const segments = parseInlineBold(children);

  return (
    <>
      {segments.map((segment, index) =>
        segment.bold ? (
          <Text key={index} style={{ fontFamily: fontFamily.serifBold }}>
            {segment.text}
          </Text>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}
