import Blockly, { WorkspaceSvg } from 'blockly'
import { useRef, useState, useEffect } from 'react'
import { Tree } from '@lezer/common'
import { Text } from '@codemirror/state'

// @ts-ignore
import De from 'blockly/msg/de'

import { codeToXml } from '../lib/blockly/codeToXml'
import { initCustomBlocks } from '../lib/blockly/customBlocks'
import { KAROL_TOOLBOX } from '../lib/blockly/toolbox'
import { parser } from '../lib/codemirror/parser/parser'
import { execPreview } from '../lib/commands/preview'
import { patch } from '../lib/commands/vm'
import { compile } from '../lib/language/compiler'
import { useCore } from '../lib/state/core'

initCustomBlocks()
;(Blockly as any).setLocale(De)

export function BlockEditor() {
  const editorDiv = useRef<HTMLDivElement>(null)
  const core = useCore()

  // console.log('render component')

  useEffect(() => {
    if (!editorDiv.current) {
      alert('Internal error. Unable to inject blockly.')
      return
    }
    //console.log('inject blockly')

    const initialXml = codeToXml(core.ws.code.toLowerCase())

    //console.log('initial', initialXml)

    const blocklyWorkspace = Blockly.inject(
      editorDiv.current,
      {
        toolbox: KAROL_TOOLBOX,
        grid: {
          spacing: 20,
          length: 3,
          colour: '#ccc',
        },
        scrollbars: true,
        trashcan: true,
      } as any /* wtf blockly types are weird*/
    )

    Blockly.Xml.domToWorkspace(
      Blockly.Xml.textToDom(initialXml),
      blocklyWorkspace
    )

    const blocklyArea = document.getElementById('blocklyArea')!
    var blocklyDiv = document.getElementById('blocklyDiv')!

    var onresize = function () {
      //console.log('on resize function')
      // Compute the absolute coordinates and dimensions of blocklyArea.
      var element = blocklyArea
      var x = 0
      var y = 0
      do {
        x += element.offsetLeft
        y += element.offsetTop
        element = element.offsetParent as any
      } while (element)
      // Position blocklyDiv over blocklyArea.
      blocklyDiv.style.left = x + 'px'
      blocklyDiv.style.top = y + 'px'
      blocklyDiv.style.width = blocklyArea.offsetWidth + 'px'
      blocklyDiv.style.height = blocklyArea.offsetHeight + 'px'
      // console.log('resize')
      Blockly.svgResize(blocklyWorkspace)
    }
    window.addEventListener('resize', onresize, false)
    onresize()

    blocklyWorkspace.scroll(
      blocklyWorkspace.scrollX + 31,
      blocklyWorkspace.scrollY + 30
    )

    core.blockyResize = onresize
    //console.log('mount', core.blockyResize)

    const myUpdateFunction = () => {
      if (blocklyWorkspace.isDragging()) return

      const newXml = Blockly.Xml.domToText(
        Blockly.Xml.workspaceToDom(blocklyWorkspace)
      )
      // console.log('xml', newXml)
      var code = (Blockly as any).karol.workspaceToCode(blocklyWorkspace)

      core.mutateWs((ws) => {
        ws.code = code
      })
      const topBlocks = blocklyWorkspace
        .getTopBlocks(false)
        .filter((bl) => !(bl as any).isInsertionMarker_)
        .filter((bl) => bl.type !== 'anweisung')

      //console.log(code, topBlocks.length)

      /*topBlocks.forEach((tp) => {
          for (const key in tp) {
            if (typeof tp[key] !== 'function') {
              console.log(key, tp[key])
            }
          }
        })*/

      if (topBlocks.length > 1) {
        core.mutateWs((ws) => {
          ws.ui.state = 'error'
          ws.ui.preview = undefined
          ws.ui.errorMessages = [`Alle Blöcke müssen zusammenhängen.`]
        })
      } else {
        const doc = Text.of(code.split('\n'))
        const tree = parser.parse(code)
        const { warnings, output } = compile(tree, doc)

        //console.log(warnings, output)
        warnings.sort((a, b) => a.from - b.from)

        if (warnings.length == 0) {
          patch(core, output)
          setTimeout(() => {
            execPreview(core)
          }, 10)
        } else {
          core.mutateWs(({ vm, ui }) => {
            vm.bytecode = undefined
            vm.pc = 0
            ui.state = 'error'
            ui.errorMessages = warnings
              .map((w) => `Zeile ${doc.lineAt(w.from).number}: ${w.message}`)
              .filter(function (item, i, arr) {
                return arr.indexOf(item) == i
              })
            //ui.preview = undefined
          })
        }
      }
      setTimeout(onresize, 0)
    }
    blocklyWorkspace.addChangeListener(myUpdateFunction)

    return () => {
      blocklyWorkspace.removeChangeListener(myUpdateFunction)
      blocklyWorkspace.dispose()
      // console.log('dispose')
      core.blockyResize = undefined
      window.removeEventListener('resize', onresize)
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div id="blocklyArea" className="w-full h-full flex-shrink">
        <div className="absolute" ref={editorDiv} id="blocklyDiv" />
      </div>
      <style jsx global>{`
        #blocklyArea svg[display='none'] {
          display: none;
        }
      `}</style>
    </>
  )
}
