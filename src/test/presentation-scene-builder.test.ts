import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { buildPresentationScene } from '../presentation'

function createTextboxObject() {
    return {
        id: 'textbox-1',
        type: 'textbox',
        x: 100,
        y: 120,
        w: 300,
        h: 120,
        rotation: 0.2,
        scalePercent: 150,
        keepAspectRatio: false,
        locked: false,
        zIndex: 2,
        parentGroupId: null,
        textboxData: {
            richTextHtml: '<p>Hello</p>',
            verticalAlignment: 'middle',
            fillMode: 'solid',
            backgroundColor: '#112233',
            fillGradient: null,
            borderColor: '#445566',
            borderType: 'solid',
            borderWidth: 2,
            radius: 10,
            opacityPercent: 90,
            shadowColor: '#000000',
            shadowBlurPx: 8,
            shadowAngleDeg: 45,
            textColor: '#ffffff',
            fontSizePx: 24,
            fontFamily: 'Arial',
            align: 'left',
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            allCaps: false,
            bulletList: false,
            numberedList: false,
            lineHeight: 1.35,
            letterSpacing: 0,
            horizontalAlign: 'left',
        },
    }
}

function createShapeObject() {
    return {
        id: 'shape-1',
        type: 'shape_rect',
        x: 10,
        y: 30,
        w: 200,
        h: 120,
        rotation: 0,
        scalePercent: 100,
        keepAspectRatio: false,
        locked: false,
        zIndex: 1,
        parentGroupId: null,
        shapeData: {
            kind: 'roundedRect',
            adjustmentPercent: 50,
            fillMode: 'solid',
            fillColor: '#224466',
            fillGradient: null,
            borderColor: '#aaccee',
            borderType: 'solid',
            borderWidth: 2,
            radius: 18,
            opacityPercent: 95,
            shadowColor: '#000000',
            shadowBlurPx: 0,
            shadowAngleDeg: 45,
        },
    }
}

describe('presentation scene builder parity', () => {
    it('renders same object count and ordering for present/export prefixes', () => {
        const objects = [createTextboxObject(), createShapeObject()]
        const dom = new JSDOM('<!doctype html><body><div id="p"></div><div id="e"></div></body>')
        const documentRef = dom.window.document
        const presentLayer = documentRef.getElementById('p') as HTMLElement
        const exportLayer = documentRef.getElementById('e') as HTMLElement

        buildPresentationScene({
            documentRef,
            layer: presentLayer,
            objects,
            assetsById: {},
            objectClassPrefix: 'present',
            textboxHtmlResolver: (object) => String(object?.textboxData?.richTextHtml || '<p><br /></p>'),
            textboxBaseStyleResolver: () => ({
                fontFamily: 'Arial',
                fontSizePx: 24,
                textColor: '#ffffff',
            }),
        })

        buildPresentationScene({
            documentRef,
            layer: exportLayer,
            objects,
            assetsById: {},
            objectClassPrefix: 'export',
            textboxHtmlResolver: (object) => String(object?.textboxData?.richTextHtml || '<p><br /></p>'),
            textboxBaseStyleResolver: () => ({
                fontFamily: 'Arial',
                fontSizePx: 24,
                textColor: '#ffffff',
            }),
        })

        const presentObjects = presentLayer.querySelectorAll('.present-object')
        const exportObjects = exportLayer.querySelectorAll('.export-object')
        expect(presentObjects).toHaveLength(2)
        expect(exportObjects).toHaveLength(2)

        expect((presentObjects[0] as HTMLElement).className.includes('shape_rect')).toBe(true)
        expect((exportObjects[0] as HTMLElement).className.includes('shape_rect')).toBe(true)
        expect((presentObjects[1] as HTMLElement).className.includes('textbox')).toBe(true)
        expect((exportObjects[1] as HTMLElement).className.includes('textbox')).toBe(true)
    })

    it('uses identical world-space geometry across prefixes', () => {
        const objects = [createTextboxObject()]
        const dom = new JSDOM('<!doctype html><body><div id="p"></div><div id="e"></div></body>')
        const documentRef = dom.window.document
        const presentLayer = documentRef.getElementById('p') as HTMLElement
        const exportLayer = documentRef.getElementById('e') as HTMLElement

        const resolver = {
            textboxHtmlResolver: (object: any) => String(object?.textboxData?.richTextHtml || '<p><br /></p>'),
            textboxBaseStyleResolver: () => ({
                fontFamily: 'Arial',
                fontSizePx: 24,
                textColor: '#ffffff',
            }),
        }

        buildPresentationScene({
            documentRef,
            layer: presentLayer,
            objects,
            assetsById: {},
            objectClassPrefix: 'present',
            ...resolver,
        })
        buildPresentationScene({
            documentRef,
            layer: exportLayer,
            objects,
            assetsById: {},
            objectClassPrefix: 'export',
            ...resolver,
        })

        const present = presentLayer.querySelector('.present-object.textbox') as HTMLElement
        const exported = exportLayer.querySelector('.export-object.textbox') as HTMLElement

        expect(present.style.left).toBe(exported.style.left)
        expect(present.style.top).toBe(exported.style.top)
        expect(present.style.width).toBe(exported.style.width)
        expect(present.style.height).toBe(exported.style.height)
        expect(present.style.transform).toBe(exported.style.transform)
    })

    it('annotates autoplay target slide and shows edit-mode style controls on hover in presentation mode', () => {
        const dom = new JSDOM('<!doctype html><body><div id="p"></div></body>')
        const documentRef = dom.window.document
        const presentLayer = documentRef.getElementById('p') as HTMLElement

        const videoObject = {
            id: 'video-1',
            type: 'video',
            x: 0,
            y: 0,
            w: 320,
            h: 180,
            rotation: 0,
            scalePercent: 100,
            keepAspectRatio: true,
            locked: false,
            zIndex: 1,
            parentGroupId: null,
            videoData: {
                assetId: 'video-asset',
                intrinsicWidth: 1280,
                intrinsicHeight: 720,
                borderColor: '#b2c6ee',
                borderType: 'solid',
                borderWidth: 0,
                radius: 0,
                opacityPercent: 100,
                autoplay: true,
                autoplaySlideId: 'slide-2',
                loop: true,
                muted: true,
                shadowColor: '#000000',
                shadowBlurPx: 0,
                shadowAngleDeg: 45,
            },
        }

        buildPresentationScene({
            documentRef,
            layer: presentLayer,
            objects: [videoObject],
            assetsById: {
                'video-asset': {
                    mimeType: 'video/mp4',
                    dataBase64: 'AAAA',
                },
            },
            objectClassPrefix: 'present',
            textboxHtmlResolver: () => '<p><br /></p>',
            textboxBaseStyleResolver: () => ({ fontFamily: 'Arial', fontSizePx: 24, textColor: '#fff' }),
        })

        const preview = presentLayer.querySelector('.canvas-video-preview') as HTMLElement
        const video = presentLayer.querySelector('video') as HTMLVideoElement
        const controls = presentLayer.querySelector('.canvas-video-controls') as HTMLElement
        const buttons = presentLayer.querySelectorAll('.canvas-video-control-btn')
        expect(video.dataset.autoplaySlideId).toBe('slide-2')
        expect(controls).toBeTruthy()
        expect(buttons).toHaveLength(2)
        expect(preview.classList.contains('hovered')).toBe(false)

        preview.dispatchEvent(new dom.window.Event('pointerenter', { bubbles: true }))
        expect(preview.classList.contains('hovered')).toBe(true)
        preview.dispatchEvent(new dom.window.Event('pointerleave', { bubbles: true }))
        expect(preview.classList.contains('hovered')).toBe(false)
    })

    it('supports hidden sound objects while keeping autoplay-capable audio in presentation mode', () => {
        const dom = new JSDOM('<!doctype html><body><div id="p"></div></body>')
        const documentRef = dom.window.document
        const presentLayer = documentRef.getElementById('p') as HTMLElement

        const soundObject = {
            id: 'sound-1',
            type: 'sound',
            x: 0,
            y: 0,
            w: 220,
            h: 56,
            rotation: 0,
            scalePercent: 100,
            keepAspectRatio: false,
            locked: false,
            zIndex: 1,
            parentGroupId: null,
            soundData: {
                assetId: 'sound-asset',
                borderColor: '#b2c6ee',
                borderType: 'solid',
                borderWidth: 0,
                radius: 18,
                opacityPercent: 100,
                autoplaySlideId: 'slide-3',
                loop: true,
                hiddenInPresentation: true,
                shadowColor: '#000000',
                shadowBlurPx: 0,
                shadowAngleDeg: 45,
            },
        }

        buildPresentationScene({
            documentRef,
            layer: presentLayer,
            objects: [soundObject],
            assetsById: {
                'sound-asset': {
                    mimeType: 'audio/mpeg',
                    dataBase64: 'AAAA',
                },
            },
            objectClassPrefix: 'present',
            textboxHtmlResolver: () => '<p><br /></p>',
            textboxBaseStyleResolver: () => ({ fontFamily: 'Arial', fontSizePx: 24, textColor: '#fff' }),
        })

        expect(presentLayer.querySelector('.present-object.sound')).toBeNull()
        const audio = presentLayer.querySelector('audio[data-autoplay-slide-id="slide-3"]') as HTMLAudioElement
        expect(audio).toBeTruthy()
        expect(audio.style.display).toBe('none')
    })
})
