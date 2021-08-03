import { EditorView } from '@codemirror/view'
import produce from 'immer'
import {
  createContext,
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { DraftFunction } from 'use-immer'
import { ensureSyntaxTree } from '@codemirror/language'
import { Diagnostic } from '@codemirror/lint'

export type Heading = 'north' | 'east' | 'south' | 'west'

export interface World {
  dimX: number
  dimY: number
  height: number
  karol: {
    x: number
    y: number
    dir: Heading
  }
  bricks: number[][]
  marks: boolean[][]
  blocks: boolean[][]
}

export interface Message {
  text: string
  count: number
  ts: number
}

export interface Ui {
  messages: Message[]
  gutter: number
  state: 'ready' | 'loading' | 'running' | 'error'
  needTextRefresh: boolean
}

export interface Vm {
  bytecode?: Op[]
  pc: number
  checkpoint?: World
  handler?: NodeJS.Timeout
}

export type Speed = 'slow' | 'fast' | 'step'

export interface Settings {
  speed: Speed
}

export interface CoreState {
  world: World
  ui: Ui
  code: string
  vm: Vm
  settings: Settings
}

export interface ActionOp {
  type: 'action'
  command: 'forward' | 'left' | 'right' | 'brick' | 'unbrick'
  line: number
}

export type Op = ActionOp

export function useCreateCore() {
  const [coreState, setCoreState] = useState<CoreState>(() =>
    getDefaultCoreState()
  )
  const coreStateRef = useRef<CoreState>(coreState)
  return useMemo(() => new Core(setCoreState, coreStateRef), [])
}

const CoreContext = createContext<Core | null>(null)

export function useCore() {
  const val = useContext(CoreContext)
  if (val) {
    return val
  }
  throw new Error('Bad usage of core state')
}

export const CoreProvider = CoreContext.Provider

class Core {
  setCoreState: Dispatch<SetStateAction<CoreState>>
  coreStateRef: MutableRefObject<CoreState>

  constructor(
    setCoreState: Dispatch<SetStateAction<CoreState>>,
    coreStateRef: MutableRefObject<CoreState>
  ) {
    this.setCoreState = setCoreState
    this.coreStateRef = coreStateRef
  }

  get current() {
    return this.coreStateRef.current
  }

  mutate(updater: DraftFunction<CoreState>) {
    const newState = produce(this.coreStateRef.current, updater)
    this.coreStateRef.current = newState
    this.setCoreState(newState)
  }

  forward(opts?: { reverse: boolean }) {
    const { world } = this.current
    const dir = opts?.reverse
      ? ({ north: 'south', south: 'north', east: 'west', west: 'east' }[
          world.karol.dir
        ] as Heading)
      : world.karol.dir
    const newPos = move(world.karol.x, world.karol.y, dir, world)
    if (newPos) {
      const myBricks = world.bricks[world.karol.y][world.karol.x]
      const newBricks = world.bricks[newPos.y][newPos.x]

      if (Math.abs(myBricks - newBricks) > 1) {
        this.addMessage('Karol kann diese Höhe nicht überwinden.')
      } else {
        this.mutate(({ world }) => {
          world.karol.x = newPos.x
          world.karol.y = newPos.y
        })
        return true
      }
    } else {
      this.addMessage('Karol kann sich nicht in diese Richtung bewegen.')
    }
    return false
  }

  left() {
    this.mutate((state) => {
      state.world.karol.dir = {
        north: 'west',
        west: 'south',
        south: 'east',
        east: 'north',
      }[state.world.karol.dir] as Heading
    })
  }

  right() {
    this.mutate((state) => {
      state.world.karol.dir = {
        north: 'east',
        east: 'south',
        south: 'west',
        west: 'north',
      }[state.world.karol.dir] as Heading
    })
  }

  brick() {
    const { world } = this.current
    const pos = move(world.karol.x, world.karol.y, world.karol.dir, world)

    if (pos) {
      if (world.bricks[pos.y][pos.x] >= world.height) {
        this.addMessage('Maximale Stapelhöhe erreicht.')
        return false
      } else {
        this.mutate((state) => {
          state.world.bricks[pos.y][pos.x] = world.bricks[pos.y][pos.x] + 1
        })
        return true
      }
    } else {
      this.addMessage('Karol kann dort keinen Ziegel aufstellen.')
      return false
    }
  }

  unbrick() {
    const { world } = this.current
    const pos = move(world.karol.x, world.karol.y, world.karol.dir, world)

    if (pos) {
      if (world.bricks[pos.y][pos.x] <= 0) {
        this.addMessage('Keine Ziegel zum Aufheben')
        return false
      } else {
        this.mutate((state) => {
          state.world.bricks[pos.y][pos.x] = world.bricks[pos.y][pos.x] - 1
        })
        return true
      }
    } else {
      this.addMessage('Karol kann dort keine Ziegel aufheben.')
      return false
    }
  }

  toggleMark() {
    this.mutate((state) => {
      const world = state.world
      world.marks[world.karol.y][world.karol.x] =
        !world.marks[world.karol.y][world.karol.x]
    })
  }

  toggleBlock() {
    const { world } = this.current
    const pos = moveRaw(world.karol.x, world.karol.y, world.karol.dir, world)
    if (pos) {
      if (world.blocks[pos.y][pos.x]) {
        this.mutate((state) => {
          state.world.blocks[pos.y][pos.x] = false
        })
        return true
      } else if (
        !world.marks[pos.y][pos.x] &&
        world.bricks[pos.y][pos.x] == 0
      ) {
        this.mutate((state) => {
          state.world.blocks[pos.y][pos.x] = true
        })
        return true
      } else {
        if (world.marks[pos.y][pos.x]) {
          this.addMessage(
            'Karol kann keinen Quader aufstellen, vor ihm liegt eine Marke.'
          )
        } else {
          this.addMessage(
            'Karol kann keinen Quader aufstellen, vor ihm liegen Ziegel.'
          )
        }
      }
    } else {
      this.addMessage(
        'Karol kann keinen Quader aufstellen, er steht vor einer Wand.'
      )
    }
    return false
  }

  createWorld(x: number, y: number, z: number) {
    this.mutate((state) => {
      state.world = createWorld(x, y, z)
    })
  }

  addMessage(text: string) {
    const newMessages = this.current.ui.messages.slice(0)
    while (newMessages.length >= 5) {
      newMessages.shift()
    }
    const ts = Date.now()
    const lastMessage = newMessages[newMessages.length - 1]
    if (lastMessage?.text == text) {
      newMessages[newMessages.length - 1] = {
        text,
        ts,
        count: lastMessage.count + 1,
      }
    } else {
      newMessages.push({ text, ts, count: 1 })
    }
    this.mutate(({ ui }) => {
      ui.messages = newMessages
    })
    const core = this
    setTimeout(() => {
      core.mutate(({ ui }) => {
        ui.messages = ui.messages.filter((m) => m.ts != ts)
      })
    }, 2500)
  }

  lint(view: EditorView) {
    if (this.current.ui.state == 'running') {
      return [] // auto formatting, ignore
    }
    const code = view.state.doc.sliceString(0)
    this.mutate((state) => {
      state.code = code
    })
    const tree = ensureSyntaxTree(view.state, 1000000, 1000)
    const output: Op[] = []
    const warnings: Diagnostic[] = []
    if (tree) {
      let cursor = tree.cursor()
      do {
        const code = view.state.doc.sliceString(cursor.from, cursor.to)
        if (cursor.name == 'Command') {
          const line = view.state.doc.lineAt(cursor.from).number
          if (code == 'Schritt') {
            output.push({
              type: 'action',
              command: 'forward',
              line,
            })
          } else if (code == 'LinksDrehen') {
            output.push({
              type: 'action',
              command: 'left',
              line,
            })
          } else if (code == 'RechtsDrehen') {
            output.push({
              type: 'action',
              command: 'right',
              line,
            })
          } else if (code == 'Hinlegen') {
            output.push({
              type: 'action',
              command: 'brick',
              line,
            })
          } else if (code == 'Aufheben') {
            output.push({
              type: 'action',
              command: 'unbrick',
              line,
            })
          } else {
            warnings.push({
              from: cursor.from,
              to: cursor.to,
              severity: 'error',
              message: `"${code}" ist kein bekannter Befehl`,
            })
          }
        }
        if (cursor.name == 'CustomRef') {
          warnings.push({
            from: cursor.from,
            to: cursor.to,
            severity: 'error',
            message: `"${code}" ist kein bekannter Befehl`,
            actions: [
              {
                name: 'Löschen',
                apply: (view, from, to) => {
                  view.dispatch({ changes: { from, to, insert: '' } })
                },
              },
            ],
          })
        }
      } while (cursor.next())
    }
    if (warnings.length == 0) {
      this.mutate((state) => {
        state.vm.bytecode = output
        state.vm.pc = 0
        state.ui.state = 'ready'
      })
    } else {
      this.mutate((state) => {
        state.vm.bytecode = undefined
        state.vm.pc = 0
        state.ui.state = 'error'
      })
    }
    return warnings
  }

  setLoading() {
    if (this.current.ui.state == 'running') {
      return // auto formatting, ignore
    }
    this.mutate(({ ui, vm }) => {
      ui.state = 'loading'
      vm.checkpoint = undefined
    })
  }

  restore() {
    this.mutate((state) => {
      if (state.vm.checkpoint) {
        state.world = state.vm.checkpoint
        state.vm.checkpoint = undefined
      }
    })
  }

  run() {
    this.mutate(({ ui, vm }) => {
      ui.state = 'running'
      vm.checkpoint = this.current.world
    })
    setTimeout(this.step.bind(this), 500)
  }

  step() {
    const pc = this.current.vm.pc
    const byteCode = this.current.vm.bytecode
    const state = this.current.ui.state

    //console.log('step', pc, byteCode, state)

    if (!byteCode || state != 'running') {
      // ignore
      return
    }
    if (pc >= byteCode.length) {
      // end reached
      this.abort()
      return
    }
    const op = byteCode[pc]
    const core = this

    this.mutate((state) => {
      state.ui.gutter = op.line
    })

    const delay =
      this.current.settings.speed == 'slow'
        ? 500
        : this.current.settings.speed == 'fast'
        ? 50
        : 0

    const h = setTimeout(() => {
      if (op.type == 'action') {
        if (op.command == 'forward') {
          core.forward()
        }
        if (op.command == 'left') {
          core.left()
        }
        if (op.command == 'right') {
          core.right()
        }
        if (op.command == 'brick') {
          core.brick()
        }
        if (op.command == 'unbrick') {
          core.unbrick()
        }
        core.mutate((state) => {
          state.vm.pc++
        })
        if (this.current.settings.speed !== 'step') {
          const h = setTimeout(() => core.step(), delay)
          this.mutate(({ vm }) => {
            vm.handler = h
          })
        }
      }
    }, delay)
    this.mutate(({ vm }) => {
      vm.handler = h
    })
  }

  serialize() {
    const { world, code } = this.current
    return { world, code }
  }

  deserialize(file?: string) {
    try {
      const { world, code }: { world: World; code: string } = JSON.parse(
        file ?? '{}'
      )
      if (!world || !code) {
        throw new Error('Datei unvollständig')
      }
      // minimal sanity check
      if (!world.dimX || !world.dimY || !world.height) {
        throw new Error('Welt beschädigt')
      }
      if (world.dimX > 100 || world.dimY > 100 || world.height > 10) {
        throw new Error('Welt ungültig')
      }
      for (let x = 0; x < world.dimX; x++) {
        for (let y = 0; y < world.dimY; y++) {
          if (
            typeof world.blocks[y][x] !== 'boolean' ||
            world.bricks[y][x] === undefined ||
            world.bricks[y][x] < 0 ||
            world.bricks[y][x] > world.height ||
            typeof world.marks[y][x] != 'boolean'
          ) {
            throw new Error('Welt enthält ungültigen Wert')
          }
        }
      }
      const ok = world
      this.mutate((state) => {
        state.world = world
        state.code = code
        state.ui.needTextRefresh = true
      })
    } catch (e) {
      alert(e.message ?? 'Laden fehlgeschlagen')
    }
  }

  refreshDone() {
    this.mutate((state) => {
      state.ui.needTextRefresh = false
    })
  }
  setSpeedHot(val: Speed) {
    clearTimeout(this.current.vm.handler!)
    this.setSpeed(val)
    if (val != 'step' && this.current.ui.state == 'running') {
      this.step()
    }
  }

  setSpeed(val: Speed) {
    this.mutate((state) => {
      state.settings.speed = val
    })
  }

  abort() {
    clearTimeout(this.current.vm.handler!)
    this.mutate((state) => {
      state.ui.gutter = 0
      state.ui.state = 'ready'
      state.vm.pc = 0
      state.vm.handler = undefined
    })
  }

  resetCheckpoint() {
    this.mutate(({ vm }) => {
      vm.checkpoint = undefined
    })
  }
}

function getDefaultCoreState(): CoreState {
  return {
    world: createWorld(5, 10, 6),
    code: '\n\n\n\n\n\n\n\n\n\n\n\n\n\n',
    ui: {
      messages: [],
      gutter: 0,
      state: 'loading',
      needTextRefresh: false,
    },
    vm: { pc: 0 },
    settings: {
      speed: 'slow',
    },
  }
}

function createWorld(dimX: number, dimY: number, height: number): World {
  return {
    dimX,
    dimY,
    height,
    karol: {
      x: 0,
      y: 0,
      dir: 'south',
    },
    bricks: Array(dimY)
      .fill(0)
      .map(() => Array(dimX).fill(0)),

    marks: Array(dimY)
      .fill(0)
      .map(() => Array(dimX).fill(false)),
    blocks: Array(dimY)
      .fill(0)
      .map(() => Array(dimX).fill(false)),
  }
}

function move(x: number, y: number, dir: Heading, world: World) {
  const pos = moveRaw(x, y, dir, world)
  if (pos && !world.blocks[pos.y][pos.x]) {
    return pos
  }
}

function moveRaw(x: number, y: number, dir: Heading, world: World) {
  if (dir == 'east') {
    if (x + 1 < world.dimX) {
      return { x: x + 1, y }
    }
  }
  if (dir == 'west') {
    if (x > 0) {
      return { x: x - 1, y }
    }
  }
  if (dir == 'south') {
    if (y + 1 < world.dimY) {
      return { x, y: y + 1 }
    }
  }
  if (dir == 'north') {
    if (y > 0) {
      return { x, y: y - 1 }
    }
  }
}
