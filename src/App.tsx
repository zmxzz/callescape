import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type HandleType,
  type NodeProps,
} from '@xyflow/react'
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FileJson2,
  Folder,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from 'lucide-react'
import { graphFileSources, graphReadOnly, graphRootName, graphRootPath, initialReviewFilters, initialReviewMode } from 'virtual:graph-files'
import { callSiteLines, diffPseudocode, firstValidGraph, parseGraph, type DiffLine, type GraphFunction, type Graph } from './graph.ts'
import { layoutGraph, type CallEdge, type Direction, type FunctionNode as FunctionNodeType, type FunctionStatus } from './layout.ts'

// The edge under the pointer, so the caller's card can mark the lines that
// produce it. Context keeps hover out of node data, which would re-run layout.
interface HoveredCall {
  edgeId: string
  callerId: string
  callee: GraphFunction | undefined
}

const HoveredCallContext = createContext<HoveredCall | null>(null)

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function lineHighlight(line: DiffLine, index: number, hovered: DiffLine | null | undefined, callSites: Set<number> | undefined): string {
  if (callSites?.has(index)) return ' linked'
  if (!hovered) return ''
  if (line === hovered || (hovered.pair != null && line.pair === hovered.pair)) return ' linked'
  return line.group === hovered.group ? ' in-hunk' : ''
}

interface PseudocodeProps {
  lines: DiffLine[]
  side: string
  lineWidth: number
  hovered?: DiffLine | null
  onHover?: (line: DiffLine | null) => void
  callSites?: Set<number>
}

function Pseudocode({ lines, side, lineWidth, hovered, onHover, callSites }: PseudocodeProps) {
  return (
    <div className="code-panel">
      <div className="code-panel-heading">{side}</div>
      <div className="code-lines nodrag nopan" style={{ '--line-width': `${lineWidth}ch` } as CSSProperties}>
        {lines.map((line, index) => (
          <span
            className={`diff-line ${line.type}${lineHighlight(line, index, hovered, callSites)}`}
            key={index}
            onMouseEnter={onHover && (() => onHover(line))}
            onMouseLeave={onHover && (() => onHover(null))}
          >
            {line.text || '\u00a0'}
          </span>
        ))}
      </div>
    </div>
  )
}

function EdgeHandles({ ids, direction, type }: { ids: string[]; direction: Direction; type: HandleType }) {
  const vertical = direction === 'TB'
  const position = type === 'target'
    ? (vertical ? Position.Top : Position.Left)
    : (vertical ? Position.Bottom : Position.Right)

  return ids.map((id, index) => {
    const offset = `${((index + 1) / (ids.length + 1)) * 100}%`
    return (
      <Handle
        key={id}
        id={id}
        type={type}
        position={position}
        isConnectable={false}
        style={vertical ? { left: offset } : { top: offset }}
      />
    )
  })
}

function FunctionNode({ data, selected }: NodeProps<FunctionNodeType>) {
  const { func, status, direction, incoming, outgoing, lineWidth } = data
  const diff = useMemo(() => diffPseudocode(func.before, func.after), [func.before, func.after])
  const [hovered, setHovered] = useState<DiffLine | null>(null)
  const hoveredCall = useContext(HoveredCallContext)
  const callee = hoveredCall?.callerId === func.id ? hoveredCall.callee : null
  const callSites = useMemo(() => callee && {
    before: new Set(callSiteLines(diff.before.map((line) => line.text), callee)),
    after: new Set(callSiteLines(diff.after.map((line) => line.text), callee)),
  }, [diff, callee])
  const panelProps = func.before && func.after
    ? { lineWidth, hovered, onHover: setHovered }
    : { lineWidth }
  return (
    <div className={`function-card ${status}${selected ? ' selected' : ''}`}>
      <EdgeHandles ids={incoming} direction={direction} type="target" />
      <header className="function-header">
        <div className="function-title-row">
          <strong title={func.name}>{func.name}</strong>
          <span className={`status-badge ${status}`}>{status}</span>
        </div>
        {func.file && <div className="function-file" title={func.file}>{func.file}</div>}
      </header>
      <div className={`code-panels ${status}`}>
        {func.before && <Pseudocode lines={diff.before} side="Before" callSites={callSites?.before} {...panelProps} />}
        {func.after && <Pseudocode lines={diff.after} side="After" callSites={callSites?.after} {...panelProps} />}
      </div>
      <EdgeHandles ids={outgoing} direction={direction} type="source" />
    </div>
  )
}

const nodeTypes = { function: FunctionNode }

interface TreeEntry {
  name: string
  path: string | null
  children: Map<string, TreeEntry>
}

function buildFileTree(paths: string[]): Pick<TreeEntry, 'children'> {
  const root: Pick<TreeEntry, 'children'> = { children: new Map() }
  for (const path of paths) {
    const segments = path.slice(1).split('/')
    let current = root
    for (const [index, segment] of segments.entries()) {
      let next = current.children.get(segment)
      if (!next) {
        next = { name: segment, path: index === segments.length - 1 ? path : null, children: new Map() }
        current.children.set(segment, next)
      }
      current = next
    }
  }
  return root
}

interface FolderBranchProps {
  entry: TreeEntry
  depth: number
  activePath: string | null
  onOpen: (path: string) => void
  onDelete?: (path: string) => void
}

function FolderBranch({ entry, depth, activePath, onOpen, onDelete }: FolderBranchProps) {
  const [expanded, setExpanded] = useState(true)
  const paddingLeft = 12 + depth * 16

  const filePath = entry.path
  if (filePath) {
    return (
      <div className={`tree-row${filePath === activePath ? ' active' : ''}`} style={{ paddingLeft }}>
        <button className="tree-open" onClick={() => onOpen(filePath)} title={filePath} aria-current={filePath === activePath ? 'page' : undefined}>
          <FileJson2 size={15} aria-hidden="true" />
          <span>{entry.name}</span>
        </button>
        {onDelete && <button className="tree-delete" onClick={() => onDelete(filePath)} title={`Delete ${filePath}`} aria-label={`Delete ${filePath}`}>
          <Trash2 size={14} aria-hidden="true" />
        </button>}
      </div>
    )
  }

  const children = [...entry.children.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  return (
    <div>
      <button className="tree-folder" style={{ paddingLeft }} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
        <span>{entry.name}</span>
      </button>
      {expanded && children.map((child) => (
        <FolderBranch key={child.name} entry={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} onDelete={onDelete} />
      ))}
    </div>
  )
}

function FolderTree({ paths, activePath, onOpen, onDelete }: Omit<FolderBranchProps, 'entry' | 'depth'> & { paths: string[] }) {
  const root = useMemo(() => buildFileTree(paths), [paths])
  const children = [...root.children.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  return (
    <nav className="folder-tree" aria-label="Graph files">
      {children.map((entry) => (
        <FolderBranch key={entry.name} entry={entry} depth={0} activePath={activePath} onOpen={onOpen} onDelete={onDelete} />
      ))}
      {children.length === 0 && <p className="tree-empty">No graph JSON files</p>}
    </nav>
  )
}

function graphEdges(edges: CallEdge[], hoveredEdgeId: string | undefined): CallEdge[] {
  return edges.map((edge): CallEdge => {
    const hovered = edge.id === hoveredEdgeId
    const stroke = hovered ? '#b4ceff' : '#8292a9'
    return {
      ...edge,
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      style: { stroke, strokeWidth: hovered ? 2.5 : 1.5 },
      labelStyle: { fill: '#d9e3f0', fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: '#1b293c', stroke: '#46566d', strokeWidth: 1 },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 5,
      pathOptions: { borderRadius: 12, offset: 24 },
    }
  })
}

const MINIMAP_COLORS: Record<FunctionStatus, string> = {
  modified: '#e9ad56',
  added: '#6ecf95',
  removed: '#e38181',
  unchanged: '#8292a9',
}

function GraphCanvas({ graph, direction }: { graph: Graph; direction: Direction }) {
  const layout = useMemo(() => layoutGraph(graph, direction), [graph, direction])
  const [nodes, , onNodesChange] = useNodesState(layout.nodes)
  const { edges } = layout
  const [hoveredCall, setHoveredCall] = useState<HoveredCall | null>(null)
  const coloredEdges = useMemo(() => graphEdges(edges, hoveredCall?.edgeId), [edges, hoveredCall])
  const functionsById = useMemo(() => new Map(graph.functions.map((func) => [func.id, func])), [graph])
  const hoverEdge = (_: MouseEvent, edge: Edge) => setHoveredCall({
    edgeId: edge.id,
    callerId: edge.source,
    callee: functionsById.get(edge.target),
  })
  const miniMapColor = (node: FunctionNodeType) => MINIMAP_COLORS[node.data.status]

  return (
    <div className="canvas">
      <HoveredCallContext.Provider value={hoveredCall}>
        <ReactFlow
          nodes={nodes}
          edges={coloredEdges}
          onNodesChange={onNodesChange}
          onEdgeMouseEnter={hoverEdge}
          onEdgeMouseLeave={() => setHoveredCall(null)}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={2}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#35445a" />
          <Controls showInteractive={false} />
          <MiniMap<FunctionNodeType> pannable zoomable nodeColor={miniMapColor} maskColor="rgba(7, 14, 26, .68)" />
        </ReactFlow>
      </HoveredCallContext.Provider>
    </div>
  )
}

export default function App() {
  const [initial] = useState(() => firstValidGraph(graphFileSources))
  const [activePath, setActivePath] = useState(initial.path)
  const [graph, setGraph] = useState(initial.graph)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = useState<Direction>('TB')
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('callscape-sidebar-width'))
    return stored ? Math.max(220, Math.min(560, stored)) : 268
  })
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('callscape-sidebar-open') !== 'false')
  const [resizing, setResizing] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reviewMode, setReviewMode] = useState(initialReviewMode)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewRevision, setReviewRevision] = useState(0)
  const [includeFiles, setIncludeFiles] = useState(initialReviewFilters.include)
  const [excludeFiles, setExcludeFiles] = useState(initialReviewFilters.exclude)
  const paths = Object.keys(graphFileSources).sort()
  const absolutePath = graphReadOnly
    ? `${graphRootPath} · in-memory review`
    : activePath ? `${graphRootPath.replace(/\/$/, '')}${activePath}` : graphRootPath

  useEffect(() => {
    localStorage.setItem('callscape-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    localStorage.setItem('callscape-sidebar-open', String(sidebarOpen))
  }, [sidebarOpen])

  useEffect(() => {
    if (!resizing) return
    const move = (event: PointerEvent) => setSidebarWidth(Math.max(220, Math.min(560, event.clientX)))
    const stop = () => setResizing(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
  }, [resizing])

  function openGraph(path: string) {
    try {
      const nextGraph = parseGraph(graphFileSources[path])
      setGraph(nextGraph)
      setActivePath(path)
      setError(null)
    } catch (cause) {
      setError(`${path}: ${errorMessage(cause)}`)
    }
  }

  async function changeReviewMode(mode: string | null) {
    if (!graphReadOnly || reviewLoading) return
    setReviewLoading(true)
    setError(null)
    try {
      const response = await fetch('/__callscape/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, include: includeFiles, exclude: excludeFiles }),
      })
      if (!response.ok) throw new Error(await response.text() || `Review failed (${response.status})`)
      setGraph(parseGraph(await response.text()))
      setReviewMode(mode)
      setReviewRevision((revision) => revision + 1)
    } catch (cause) {
      setError(`Could not update review: ${errorMessage(cause)}`)
    } finally {
      setReviewLoading(false)
    }
  }

  async function confirmDelete() {
    if (graphReadOnly || !deleteCandidate || deleting) return
    setDeleting(true)
    try {
      const response = await fetch(`/__callscape/graph-file?path=${encodeURIComponent(deleteCandidate)}`, { method: 'DELETE' })
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || `Delete failed (${response.status})`)
      }
      setDeleteCandidate(null)
      window.location.reload()
    } catch (cause) {
      setError(`Could not delete ${deleteCandidate}: ${errorMessage(cause)}`)
      setDeleteCandidate(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar${sidebarOpen ? '' : ' collapsed'}`} style={{ width: sidebarOpen ? sidebarWidth : 0 }}>
        <div className="sidebar-heading">
          <span>{graphReadOnly ? 'REVIEW' : 'GRAPH FILES'}</span>
          {!graphReadOnly && <span className="file-count">{paths.length}</span>}
        </div>
        {graphReadOnly && (
          <div className="review-selector">
            <label htmlFor="review-mode">Compare</label>
            <select id="review-mode" value={reviewMode ?? ''} disabled={reviewLoading} onChange={(event) => changeReviewMode(event.target.value)}>
              {initialReviewMode === 'custom' && <option value="custom">Custom comparison</option>}
              <option value="uncommitted">Uncommitted changes</option>
              <option value="last-commit">Last commit</option>
              <option value="against-main">Changes against main</option>
            </select>
            <form className="review-file-filters" onSubmit={(event) => { event.preventDefault(); changeReviewMode(reviewMode) }}>
              <label htmlFor="review-include">Include</label>
              <input id="review-include" type="text" value={includeFiles} onChange={(event) => setIncludeFiles(event.target.value)} placeholder="src/**" disabled={reviewLoading} />
              <label htmlFor="review-exclude">Exclude</label>
              <input id="review-exclude" type="text" value={excludeFiles} onChange={(event) => setExcludeFiles(event.target.value)} placeholder="**/tests/**" disabled={reviewLoading} />
              <span className="filter-hint">Comma-separated globs · blank includes all files</span>
              <button type="submit" disabled={reviewLoading}>Apply filters</button>
            </form>
            {reviewLoading && <span role="status">Analyzing…</span>}
          </div>
        )}
        <div className="sidebar-scroll">
          {graphReadOnly ? (
            <p className="review-hint">The graph stays in memory. Choose a comparison to rebuild it.</p>
          ) : (
            <FolderTree paths={paths} activePath={activePath} onOpen={openGraph} onDelete={setDeleteCandidate} />
          )}
        </div>
        <div className="sidebar-legend">
          <div><span className="legend-swatch removed" /> Deleted lines</div>
          <div><span className="legend-swatch added" /> Added lines</div>
        </div>
        {sidebarOpen && <div className="sidebar-resize" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" onPointerDown={(event) => { event.preventDefault(); setResizing(true) }} />}
      </aside>
      <section className="workspace">
        <header className="workspace-header">
          <button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <div className="graph-heading">
            <div className="graph-summary">
              <strong>{graph?.title || 'Callescape'}</strong>
              <span>{graph?.functions.length || 0} functions · {graph?.calls.length || 0} calls</span>
            </div>
            <div className="graph-path" title={absolutePath}>{absolutePath}</div>
          </div>
          <div className="layout-switch" role="group" aria-label="Graph layout">
            <button className={direction === 'TB' ? 'active' : ''} onClick={() => setDirection('TB')} aria-label="Vertical layout" aria-pressed={direction === 'TB'}><ArrowDown size={16} /><span>Vertical</span></button>
            <button className={direction === 'LR' ? 'active' : ''} onClick={() => setDirection('LR')} aria-label="Horizontal layout" aria-pressed={direction === 'LR'}><ArrowRight size={16} /><span>Horizontal</span></button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error} <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        {graphReadOnly && graph?.functions.length === 0 ? (
          <div className="empty-state">No changed functions in this comparison.</div>
        ) : graph ? <GraphCanvas key={`${activePath}-${direction}-${reviewMode}-${reviewRevision}`} graph={graph} direction={direction} /> : (
          <div className="empty-state">No valid graph JSON files in {graphRootName}.</div>
        )}
      </section>
      {deleteCandidate && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setDeleteCandidate(null) }}>
          <div className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
            <h2 id="delete-title">Delete graph file?</h2>
            <p id="delete-description">This removes the selected JSON file from the graph folder.</p>
            <code>{deleteCandidate}</code>
            <div className="dialog-actions">
              <button onClick={() => setDeleteCandidate(null)} disabled={deleting}>Cancel</button>
              <button className="danger-button" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete file'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
