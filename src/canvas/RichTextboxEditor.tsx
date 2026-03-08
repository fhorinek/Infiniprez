import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAlignCenter,
  faAlignLeft,
  faAlignRight,
  faArrowsDownToLine,
  faArrowsUpToLine,
  faBold,
  faEraser,
  faHighlighter,
  faItalic,
  faListOl,
  faListUl,
  faMinus,
  faPlus,
  faStrikethrough,
  faUnderline,
} from '@fortawesome/free-solid-svg-icons'
import { Color } from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Extension, type ChainedCommands } from '@tiptap/core'
import { COMMON_TEXTBOX_FONTS } from '../fontAssets'
import type { TextVerticalAlignment } from '../model'
import type { TextStyleRole } from '../stylePresets'
const FONT_SIZE_POINTS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]
const MIN_FONT_SIZE_PT = 6
const MAX_FONT_SIZE_PT = 240
const PX_PER_PT = 96 / 72

function pxToPt(px: number): number {
  return px / PX_PER_PT
}

function ptToPx(pt: number): number {
  return pt * PX_PER_PT
}

function clampFontSizePt(pt: number): number {
  return Math.max(MIN_FONT_SIZE_PT, Math.min(MAX_FONT_SIZE_PT, Number(pt.toFixed(1))))
}

function parseFontSizeToPt(value: string | undefined): number {
  if (!value) {
    return pxToPt(28)
  }
  const numeric = Number(value.replace('px', '').replace('pt', '').trim())
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return pxToPt(28)
  }
  if (value.endsWith('pt')) {
    return numeric
  }
  return pxToPt(numeric)
}

function formatPt(pt: number): string {
  return Number.isInteger(pt) ? String(pt) : pt.toFixed(1)
}

function normalizeColorValue(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function measureEditorContentHeightPx(element: HTMLElement, contentScale: number): number {
  if (typeof document === 'undefined') {
    return element.scrollHeight
  }

  const safeScale = Math.max(0.0001, contentScale)
  const rect = element.getBoundingClientRect()
  const widthPx = Math.max(1, (rect.width || element.clientWidth || 1) / safeScale)
  const probe = element.cloneNode(true) as HTMLElement

  probe.style.position = 'fixed'
  probe.style.left = '-100000px'
  probe.style.top = '0'
  probe.style.width = `${widthPx}px`
  probe.style.height = 'auto'
  probe.style.minHeight = '0px'
  probe.style.maxHeight = 'none'
  probe.style.transform = 'none'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  probe.style.overflow = 'visible'
  probe.style.display = 'block'

  document.body.appendChild(probe)
  const measuredHeight = probe.scrollHeight
  probe.remove()
  return measuredHeight
}

function createFallbackTextStyles(fontFamily: string, defaultTextColor: string): TextStyleRole[] {
  return [
    {
      id: 'title',
      label: 'Title',
      fontFamily,
      fontSize: 56,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: defaultTextColor,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'heading',
      label: 'Heading',
      fontFamily,
      fontSize: 36,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: defaultTextColor,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'description',
      label: 'Description',
      fontFamily,
      fontSize: 24,
      fontWeight: 400,
      italic: false,
      underline: false,
      color: defaultTextColor,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'label',
      label: 'Label',
      fontFamily,
      fontSize: 18,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: defaultTextColor,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'text',
      label: 'Text',
      fontFamily,
      fontSize: 28,
      fontWeight: 400,
      italic: false,
      underline: false,
      color: defaultTextColor,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'caption',
      label: 'Caption',
      fontFamily,
      fontSize: 16,
      fontWeight: 400,
      italic: true,
      underline: false,
      color: defaultTextColor,
      alignment: 'left',
      listType: 'none',
    },
  ]
}

const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: { fontSize?: string | null }) => {
              if (!attributes.fontSize) {
                return {}
              }
              return { style: `font-size: ${attributes.fontSize}` }
            },
          },
        },
      },
    ]
  },
})

const TabKeymap = Extension.create({
  name: 'tabKeymap',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('listItem')) {
          const didIndent = this.editor.commands.sinkListItem('listItem')
          if (didIndent) {
            return true
          }
        }
        return this.editor.commands.insertContent('\t')
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('listItem')) {
          const didOutdent = this.editor.commands.liftListItem('listItem')
          if (didOutdent) {
            return true
          }
        }
        return true
      },
    }
  },
})

interface RichTextboxEditorProps {
  editorKey: string
  html: string
  fontFamily: string
  availableFontFamilies?: string[]
  textStyleOptions?: TextStyleRole[]
  defaultFontSizePx: number
  defaultTextColor: string
  verticalAlignment: TextVerticalAlignment
  onVerticalAlignmentChange: (next: TextVerticalAlignment) => void
  contentScale: number
  onContentChange: (next: { html: string; plainText: string; contentHeight: number }) => void
  onEditorBlur: (relatedTarget: EventTarget | null) => void
  onEscape: () => void
  onCommit: () => void
}

export function RichTextboxEditor({
  editorKey,
  html,
  fontFamily,
  availableFontFamilies = COMMON_TEXTBOX_FONTS,
  textStyleOptions = [],
  defaultFontSizePx,
  defaultTextColor,
  verticalAlignment,
  onVerticalAlignmentChange,
  contentScale,
  onContentChange,
  onEditorBlur,
  onEscape,
  onCommit,
}: RichTextboxEditorProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const lastRangeSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const initializedEditorKeyRef = useRef<string | null>(null)
  const onContentChangeRef = useRef(onContentChange)
  const contentScaleRef = useRef(contentScale)
  const [fontSizePtValue, setFontSizePtValue] = useState(clampFontSizePt(pxToPt(defaultFontSizePx)))
  const [fontSizePtInput, setFontSizePtInput] = useState(formatPt(clampFontSizePt(pxToPt(defaultFontSizePx))))
  const [fontFamilyValue, setFontFamilyValue] = useState(fontFamily)
  const [textColor, setTextColor] = useState(defaultTextColor)
  const [highlightColor, setHighlightColor] = useState('#fff59d')
  const [verticalAlignmentValue, setVerticalAlignmentValue] = useState<TextVerticalAlignment>(verticalAlignment)
  const [selectedTextStyleId, setSelectedTextStyleId] = useState('__custom')
  const resolvedTextStyleOptions = useMemo(() => {
    const deduped = new Map<string, TextStyleRole>()
    for (const entry of textStyleOptions) {
      deduped.set(entry.id, entry)
    }
    if (deduped.size > 0) {
      return [...deduped.values()]
    }
    return createFallbackTextStyles(fontFamily, defaultTextColor)
  }, [defaultTextColor, fontFamily, textStyleOptions])
  const fontFamilyOptions = useMemo(() => {
    const next = [...availableFontFamilies]
    if (!next.includes(fontFamily)) {
      next.push(fontFamily)
    }
    if (!next.includes(fontFamilyValue)) {
      next.push(fontFamilyValue)
    }
    return next
  }, [availableFontFamilies, fontFamily, fontFamilyValue])

  useEffect(() => {
    onContentChangeRef.current = onContentChange
  }, [onContentChange])

  useEffect(() => {
    contentScaleRef.current = contentScale
  }, [contentScale])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Underline,
        TextStyle,
        FontSize,
        TabKeymap,
        TextAlign.configure({
          types: ['paragraph', 'heading'],
        }),
        Color,
        FontFamily,
        Highlight.configure({ multicolor: true }),
      ],
      content: html,
      editorProps: {
        attributes: {
          class: 'textbox-rich-content',
          style: `font-family: ${fontFamily}; font-size: ${defaultFontSizePx}px; color: ${defaultTextColor};`,
        },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onEscape()
            return true
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            onCommit()
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        const nextHtml = currentEditor.getHTML()
        const plainText = currentEditor.getText({ blockSeparator: '\n' })
        const contentHeight = measureEditorContentHeightPx(
          currentEditor.view.dom as HTMLElement,
          contentScaleRef.current
        )
        onContentChangeRef.current({
          html: nextHtml,
          plainText,
          contentHeight,
        })
      },
    },
    [editorKey]
  )

  const readToolbarState = useCallback(() => {
    if (!editor) {
      return
    }
    const selection = editor.state.selection
    const nextSelection = { from: selection.from, to: selection.to }
    lastSelectionRef.current = nextSelection
    if (nextSelection.to > nextSelection.from) {
      lastRangeSelectionRef.current = nextSelection
    }

    const textStyle = editor.getAttributes('textStyle') as {
      fontSize?: string
      fontFamily?: string
      color?: string
    }
    const highlight = editor.getAttributes('highlight') as {
      color?: string
    }

    const fontSizePt = clampFontSizePt(parseFontSizeToPt(textStyle.fontSize || `${defaultFontSizePx}px`))
    setFontSizePtValue(fontSizePt)
    setFontSizePtInput(formatPt(fontSizePt))
    setFontFamilyValue(textStyle.fontFamily || fontFamily)
    setTextColor(textStyle.color || defaultTextColor)
    setHighlightColor(highlight.color || '#fff59d')

    const activeListType = editor.isActive('bulletList')
      ? 'bullet'
      : editor.isActive('orderedList')
        ? 'numbered'
        : 'none'
    const activeAlignment = editor.isActive({ textAlign: 'center' })
      ? 'center'
      : editor.isActive({ textAlign: 'right' })
        ? 'right'
        : 'left'
    const activeBold = editor.isActive('bold')
    const activeItalic = editor.isActive('italic')
    const activeUnderline = editor.isActive('underline')
    const activeColor = normalizeColorValue(textStyle.color || defaultTextColor)
    const activeFontFamily = (textStyle.fontFamily || fontFamily).trim()
    const activeFontSizePx = ptToPx(fontSizePt)
    const matchedStyle =
      resolvedTextStyleOptions.find((entry) => {
        const styleColor = normalizeColorValue(entry.color)
        return (
          entry.fontFamily === activeFontFamily &&
          Math.abs(entry.fontSize - activeFontSizePx) <= 0.5 &&
          styleColor === activeColor &&
          entry.alignment === activeAlignment &&
          entry.listType === activeListType &&
          (entry.fontWeight >= 600) === activeBold &&
          entry.italic === activeItalic &&
          entry.underline === activeUnderline
        )
      }) ?? null
    setSelectedTextStyleId(matchedStyle?.id ?? '__custom')
  }, [defaultFontSizePx, defaultTextColor, editor, fontFamily, resolvedTextStyleOptions])

  useEffect(() => {
    if (!editor) {
      return
    }

    readToolbarState()
    const onAnyUpdate = () => {
      readToolbarState()
    }
    editor.on('selectionUpdate', onAnyUpdate)
    editor.on('transaction', onAnyUpdate)
    return () => {
      editor.off('selectionUpdate', onAnyUpdate)
      editor.off('transaction', onAnyUpdate)
    }
  }, [editor, readToolbarState])

  useEffect(() => {
    if (!editor) {
      return
    }
    const dom = editor.view.dom as HTMLElement
    dom.className = `textbox-rich-content textbox-v-align-${verticalAlignmentValue}`
    dom.style.fontFamily = fontFamilyValue
    dom.style.fontSize = `${ptToPx(fontSizePtValue)}px`
    dom.style.color = textColor
  }, [editor, fontFamilyValue, fontSizePtValue, textColor, verticalAlignmentValue])

  useEffect(() => {
    setFontFamilyValue(fontFamily)
  }, [fontFamily])

  useEffect(() => {
    const nextFontSizePt = clampFontSizePt(pxToPt(defaultFontSizePx))
    setFontSizePtValue(nextFontSizePt)
    setFontSizePtInput(formatPt(nextFontSizePt))
  }, [defaultFontSizePx])

  useEffect(() => {
    setTextColor(defaultTextColor)
  }, [defaultTextColor])

  useEffect(() => {
    setVerticalAlignmentValue(verticalAlignment)
  }, [verticalAlignment])

  useEffect(() => {
    if (!editor) {
      return
    }
    if (initializedEditorKeyRef.current === editorKey) {
      return
    }
    initializedEditorKeyRef.current = editorKey
    lastSelectionRef.current = null
    lastRangeSelectionRef.current = null
    editor.commands.focus('end')
    const contentHeight = measureEditorContentHeightPx(
      editor.view.dom as HTMLElement,
      contentScaleRef.current
    )
    onContentChangeRef.current({
      html: editor.getHTML(),
      plainText: editor.getText({ blockSeparator: '\n' }),
      contentHeight,
    })
  }, [editor, editorKey])

  const runToolbarCommand = useCallback(
    (build: (chain: ChainedCommands) => ChainedCommands) => {
      if (!editor) {
        return
      }
      let chain = editor.chain().focus()
      const currentSelection = editor.state.selection
      const liveSelection = {
        from: currentSelection.from,
        to: currentSelection.to,
      }
      if (liveSelection.to > liveSelection.from) {
        lastRangeSelectionRef.current = liveSelection
        chain = chain.setTextSelection(liveSelection)
      } else {
        const savedSelection = lastRangeSelectionRef.current ?? lastSelectionRef.current
        if (savedSelection && savedSelection.to > savedSelection.from) {
          chain = chain.setTextSelection(savedSelection)
        }
      }
      build(chain).run()
    },
    [editor]
  )

  const applyFontSizePt = useCallback(
    (nextPt: number) => {
      const clampedPt = clampFontSizePt(nextPt)
      const clampedPx = ptToPx(clampedPt)
      setFontSizePtValue(clampedPt)
      setFontSizePtInput(formatPt(clampedPt))
      runToolbarCommand((chain) => chain.setMark('textStyle', { fontSize: `${clampedPx}px` }))
    },
    [runToolbarCommand]
  )

  const applyFontSizeInput = useCallback(() => {
    const parsed = Number(fontSizePtInput)
    if (Number.isFinite(parsed) && parsed > 0) {
      applyFontSizePt(parsed)
      return
    }
    setFontSizePtInput(formatPt(fontSizePtValue))
  }, [applyFontSizePt, fontSizePtInput, fontSizePtValue])

  const toggleBulletList = useCallback(() => {
    if (!editor) {
      return
    }
    runToolbarCommand((chain) => {
      if (editor.isActive('orderedList')) {
        return chain.toggleOrderedList().toggleBulletList()
      }
      return chain.toggleBulletList()
    })
  }, [editor, runToolbarCommand])

  const toggleOrderedList = useCallback(() => {
    if (!editor) {
      return
    }
    runToolbarCommand((chain) => {
      if (editor.isActive('bulletList')) {
        return chain.toggleBulletList().toggleOrderedList()
      }
      return chain.toggleOrderedList()
    })
  }, [editor, runToolbarCommand])

  const applyTextStyleOption = useCallback(
    (styleId: string) => {
      if (!editor) {
        return
      }
      if (styleId === '__custom') {
        setSelectedTextStyleId('__custom')
        return
      }
      const entry = resolvedTextStyleOptions.find((candidate) => candidate.id === styleId)
      if (!entry) {
        return
      }
      const targetColor = normalizeColorValue(entry.color)
      setSelectedTextStyleId(entry.id)
      setFontFamilyValue(entry.fontFamily)
      setFontSizePtValue(clampFontSizePt(pxToPt(entry.fontSize)))
      setFontSizePtInput(formatPt(clampFontSizePt(pxToPt(entry.fontSize))))
      setTextColor(entry.color)
      runToolbarCommand((chain) => {
        let next = chain

        if (editor.isActive('bulletList') && entry.listType !== 'bullet') {
          next = next.toggleBulletList()
        }
        if (editor.isActive('orderedList') && entry.listType !== 'numbered') {
          next = next.toggleOrderedList()
        }
        if (entry.listType === 'bullet' && !editor.isActive('bulletList')) {
          next = next.toggleBulletList()
        } else if (entry.listType === 'numbered' && !editor.isActive('orderedList')) {
          next = next.toggleOrderedList()
        }

        next = next.setTextAlign(entry.alignment)
        if (entry.fontWeight >= 600) {
          next = next.setBold()
        } else {
          next = next.unsetBold()
        }
        if (entry.italic) {
          next = next.setItalic()
        } else {
          next = next.unsetItalic()
        }
        if (entry.underline) {
          next = next.setUnderline()
        } else {
          next = next.unsetUnderline()
        }

        const currentColor = normalizeColorValue((editor.getAttributes('textStyle') as { color?: string }).color)
        if (currentColor !== targetColor) {
          next = next.setColor(entry.color)
        }

        return next
          .setFontFamily(entry.fontFamily)
          .setMark('textStyle', { fontSize: `${entry.fontSize}px` })
      })
    },
    [editor, resolvedTextStyleOptions, runToolbarCommand]
  )

  const applyVerticalAlignment = useCallback(
    (next: TextVerticalAlignment) => {
      setVerticalAlignmentValue(next)
      onVerticalAlignmentChange(next)
    },
    [onVerticalAlignmentChange]
  )

  return (
    <div
      className="textbox-editor-shell"
      ref={shellRef}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null
        if (nextTarget && shellRef.current?.contains(nextTarget)) {
          return
        }
        onEditorBlur(event.relatedTarget)
      }}
    >
      <div
        className="textbox-native-toolbar"
        role="toolbar"
        aria-label="Text formatting"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('button')) {
            event.preventDefault()
          }
        }}
      >
        <div className="textbox-toolbar-row">
          <label className="textbox-toolbar-field textbox-toolbar-text-style">
            <span>Style</span>
            <select
              value={selectedTextStyleId}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                applyTextStyleOption(event.target.value)
              }}
            >
              <option value="__custom">Custom</option>
              {resolvedTextStyleOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <label className="textbox-toolbar-field textbox-toolbar-font-family">
            <span>Font</span>
            <select
              value={fontFamilyValue}
              style={{ fontFamily: fontFamilyValue }}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = event.target.value
                setFontFamilyValue(value)
                runToolbarCommand((chain) => chain.setFontFamily(value))
              }}
            >
              {fontFamilyOptions.map((entry) => (
                <option key={entry} value={entry} style={{ fontFamily: entry }}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <label className="textbox-toolbar-field textbox-toolbar-font-size">
            <span>Size</span>
            <div className="textbox-toolbar-size-control">
              <input
                type="number"
                min={MIN_FONT_SIZE_PT}
                max={MAX_FONT_SIZE_PT}
                step={0.5}
                list="textbox-font-size-pt-options"
                value={fontSizePtInput}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  setFontSizePtInput(event.target.value)
                  const parsed = Number(event.target.value)
                  if (Number.isFinite(parsed) && parsed > 0) {
                    applyFontSizePt(parsed)
                  }
                }}
                onBlur={applyFontSizeInput}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyFontSizeInput()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setFontSizePtInput(formatPt(fontSizePtValue))
                  }
                }}
                aria-label="Font size in points"
                title="Font size in points"
              />
              <button
                type="button"
                className="textbox-toolbar-icon-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyFontSizePt(fontSizePtValue + 1)}
                aria-label="Increase font size"
                title="Increase font size"
              >
                <FontAwesomeIcon icon={faPlus} />
              </button>
              <button
                type="button"
                className="textbox-toolbar-icon-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyFontSizePt(fontSizePtValue - 1)}
                aria-label="Decrease font size"
                title="Decrease font size"
              >
                <FontAwesomeIcon icon={faMinus} />
              </button>
            </div>
          </label>
          <datalist id="textbox-font-size-pt-options">
            {FONT_SIZE_POINTS.map((sizePt) => (
              <option key={sizePt} value={sizePt} />
            ))}
          </datalist>

        </div>

        <div className="textbox-toolbar-row">
          <div className="textbox-toolbar-section">
            <span className="textbox-toolbar-section-label">Style</span>
            <div className="textbox-toolbar-section-controls">
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive('bold') ? 'active' : ''}`}
                aria-label="Bold"
                title="Bold"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.toggleBold())}
              >
                <FontAwesomeIcon icon={faBold} />
              </button>
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive('italic') ? 'active' : ''}`}
                aria-label="Italic"
                title="Italic"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.toggleItalic())}
              >
                <FontAwesomeIcon icon={faItalic} />
              </button>
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive('underline') ? 'active' : ''}`}
                aria-label="Underline"
                title="Underline"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.toggleUnderline())}
              >
                <FontAwesomeIcon icon={faUnderline} />
              </button>
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive('strike') ? 'active' : ''}`}
                aria-label="Strikethrough"
                title="Strikethrough"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.toggleStrike())}
              >
                <FontAwesomeIcon icon={faStrikethrough} />
              </button>
            </div>
          </div>

          <div className="textbox-toolbar-divider" />

          <label className="textbox-toolbar-field">
            <span>Color</span>
            <input
              type="color"
              value={textColor}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = event.target.value
                setTextColor(value)
                runToolbarCommand((chain) => chain.setColor(value))
              }}
              aria-label="Text color"
              title="Text color"
            />
          </label>

          <label className="textbox-toolbar-field">
            <span>Highlight</span>
            <div className="textbox-toolbar-highlight-control">
              <input
                type="color"
                value={highlightColor}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  const value = event.target.value
                  setHighlightColor(value)
                  runToolbarCommand((chain) => chain.setHighlight({ color: value }))
                }}
                aria-label="Highlight color"
                title="Highlight color"
              />
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive('highlight') ? 'active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.setHighlight({ color: highlightColor }))}
                aria-label="Apply highlight"
                title="Apply highlight"
              >
                <FontAwesomeIcon icon={faHighlighter} />
              </button>
              <button
                type="button"
                className="textbox-toolbar-icon-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.unsetHighlight())}
                aria-label="Clear highlight"
                title="Clear highlight"
              >
                <FontAwesomeIcon icon={faEraser} />
              </button>
            </div>
          </label>

          <div className="textbox-toolbar-divider" />

          <div className="textbox-toolbar-section">
            <span className="textbox-toolbar-section-label">List</span>
            <div className="textbox-toolbar-list-toggle" role="group" aria-label="List type">
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive('bulletList') ? 'active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={toggleBulletList}
                aria-label="Bullet list"
                title="Bullet list"
              >
                <FontAwesomeIcon icon={faListUl} />
              </button>
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive('orderedList') ? 'active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={toggleOrderedList}
                aria-label="Numbered list"
                title="Numbered list"
              >
                <FontAwesomeIcon icon={faListOl} />
              </button>
            </div>
          </div>

          <div className="textbox-toolbar-divider" />

          <div className="textbox-toolbar-section">
            <span className="textbox-toolbar-section-label">Align</span>
            <div className="textbox-toolbar-section-controls">
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive({ textAlign: 'left' }) ||
                  (!editor?.isActive({ textAlign: 'center' }) && !editor?.isActive({ textAlign: 'right' }))
                  ? 'active'
                  : ''
                  }`}
                aria-label="Align left"
                title="Align left"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.setTextAlign('left'))}
              >
                <FontAwesomeIcon icon={faAlignLeft} />
              </button>
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive({ textAlign: 'center' }) ? 'active' : ''}`}
                aria-label="Align center"
                title="Align center"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.setTextAlign('center'))}
              >
                <FontAwesomeIcon icon={faAlignCenter} />
              </button>
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive({ textAlign: 'right' }) ? 'active' : ''}`}
                aria-label="Align right"
                title="Align right"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.setTextAlign('right'))}
              >
                <FontAwesomeIcon icon={faAlignRight} />
              </button>
              <div className="textbox-toolbar-divider textbox-toolbar-inline-divider" />
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${verticalAlignmentValue === 'top' ? 'active' : ''}`}
                aria-label="Align top"
                title="Align top"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyVerticalAlignment('top')}
              >
                <FontAwesomeIcon icon={faArrowsUpToLine} />
              </button>
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${verticalAlignmentValue === 'middle' ? 'active' : ''}`}
                aria-label="Align middle"
                title="Align middle"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyVerticalAlignment('middle')}
              >
                <FontAwesomeIcon icon={faAlignCenter} className="alignment-icon-vertical" />
              </button>
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${verticalAlignmentValue === 'bottom' ? 'active' : ''}`}
                aria-label="Align bottom"
                title="Align bottom"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyVerticalAlignment('bottom')}
              >
                <FontAwesomeIcon icon={faArrowsDownToLine} />
              </button>
            </div>
          </div>

        </div>
      </div>

      <div
        className="textbox-rich-editor-surface"
        style={{
          transform: `scale(${contentScale})`,
          transformOrigin: 'top left',
          width: `${100 / contentScale}%`,
          height: `${100 / contentScale}%`,
        }}
      >
        <EditorContent editor={editor} className="textbox-rich-editor" />
      </div>
    </div >
  )
}
