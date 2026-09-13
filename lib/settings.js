/**
 * dsh-mama-cheer — settings screen contribution.
 *
 * Display metadata only: storage, validation and layering stay with the dsh
 * settings service, and the plugin reads its own values back through the
 * registered namespace (`settings.register(SETTINGS_NS, Config)`). Keeping the
 * two in one place is what makes `ns` here and the namespace the plugin
 * registers impossible to drift apart.
 *
 * @module dsh-mama-cheer/settings
 */

/** Settings namespace; the dsh settings service requires a lowercase hyphenated id. */
export const SETTINGS_NS = 'dsh-mama-cheer'

/** Provider-owned translations for one label or hint. */
const both = (zh, en) => ({ zh, en })

/** `interruptMode` choices, in the order the settings screen cycles them. */
export const INTERRUPT_OPTIONS = Object.freeze([
  {
    value: 'smart',
    label: 'Smart',
    descriptions: both('智能：有工具在跑就不打断', 'Smart: never interrupt a tool in flight'),
  },
  {
    value: 'always',
    label: 'Always interrupt',
    descriptions: both('总是打断当前这一步', 'Always interrupt while the model is running'),
  },
  {
    value: 'never',
    label: 'Never interrupt',
    descriptions: both('从不打断，只在 step 边界插话', 'Never interrupt: steer at the step boundary only'),
  },
])

/** `display` choices. */
export const DISPLAY_OPTIONS = Object.freeze([
  {
    value: 'toast',
    label: 'Toast',
    descriptions: both('瞬时提示；消息不进对话', 'Transient notice; the message stays out of the transcript'),
  },
  {
    value: 'none',
    label: 'Silent',
    descriptions: both('完全安静，只有日志记录', 'No visible feedback at all'),
  },
  {
    value: 'bubble',
    label: 'User message',
    descriptions: both('显示成普通用户消息', 'Render as a normal user message'),
  },
])

/**
 * Build the settings section descriptor.
 *
 * The field paths are the settings service's `mutate` vocabulary, so they must
 * stay identical to the {@link Config} keys the plugin registers.
 *
 * @returns a section descriptor for `ctx.tuiSettingsSections.register`.
 */
export function buildSection() {
  return {
    ns: SETTINGS_NS,
    title: 'Mama Cheer',
    descriptions: both('妈妈加油：快捷键插话', 'Mama Cheer: shortcut message injection'),
    fields: [
      {
        path: ['text'],
        label: 'Cheer message',
        descriptions: both('鼓励文案', 'Cheer message'),
        hint: 'Delivered to the model; never a transcript bubble while display is toast or silent',
        hintDescriptions: both(
          '送给模型的文本；显示方式为 toast/安静时不会出现在对话里',
          'Delivered to the model; never a transcript bubble while display is toast or silent',
        ),
        kind: 'text',
        placeholder: '妈妈加油！',
      },
      {
        path: ['combo'],
        label: 'Shortcut',
        descriptions: both('快捷键', 'Shortcut'),
        hint: 'Must carry ctrl or alt; reserved combos are refused by the host',
        hintDescriptions: both(
          '必须含 ctrl 或 alt；保留键会被宿主拒绝',
          'Must carry ctrl or alt; reserved combos are refused by the host',
        ),
        kind: 'text',
        placeholder: 'ctrl+alt+m',
      },
      {
        path: ['interruptMode'],
        label: 'Interrupt policy',
        descriptions: both('打断策略', 'Interrupt policy'),
        hint: 'Interrupting keeps the half-written answer but aborts the current step',
        hintDescriptions: both(
          '打断会保留半截回答，但当前这一步会被中止',
          'Interrupting keeps the half-written answer but aborts the current step',
        ),
        kind: 'select',
        options: INTERRUPT_OPTIONS,
      },
      {
        path: ['display'],
        label: 'Display',
        descriptions: both('显示方式', 'Display'),
        kind: 'select',
        options: DISPLAY_OPTIONS,
      },
      {
        path: ['toastMs'],
        label: 'Toast lifetime (ms)',
        descriptions: both('提示停留时长（毫秒）', 'Toast lifetime (ms)'),
        hint: 'Host clamps to 500–12000',
        hintDescriptions: both('宿主钳制在 500–12000', 'Host clamps to 500–12000'),
        kind: 'number',
        placeholder: '3000',
      },
      {
        path: ['keepInbox'],
        label: 'Keep my queued messages',
        descriptions: both('中断时保留我排队的消息', 'Keep my queued messages across an interrupt'),
        kind: 'boolean',
      },
    ],
  }
}
