import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader'
import rhino3dm from 'rhino3dm'
import { RhinoCompute } from 'rhino_compute'

// set up loader for converting the results to threejs
const loader = new Rhino3dmLoader()
loader.setLibraryPath( 'https://unpkg.com/rhino3dm@8.0.0-beta3/' )

// initialise 'data' object that will be used by compute()
const data = {
  definition: definitionName,
  inputs: getInputs()
}

// globals
let doc, scene, camera, renderer, controls

const rhino = await rhino3dm()
console.log('Loaded rhino3dm.')

init()
compute()
await updateMarkdownAndTags()


  /////////////////////////////////////////////////////////////////////////////
 //                            HELPER  FUNCTIONS                            //
/////////////////////////////////////////////////////////////////////////////

/**
 * Gets <input> elements from html and sets handlers
 * (html is generated from the grasshopper definition)
 */
function getInputs() {
  const inputs = {}
  for (const input of document.getElementsByTagName('input')) {
    switch (input.type) {
      case 'number':
        inputs[input.id] = input.valueAsNumber
        input.onchange = onSliderChange
        break
      case 'range':
        inputs[input.id] = input.valueAsNumber
        input.onmouseup = onSliderChange
        input.ontouchend = onSliderChange
        break
      case 'checkbox':
        inputs[input.id] = input.checked
        input.onclick = onSliderChange
        break
      default:
        break
    }
  }
  return inputs
}

/**
 * Sets up the scene, camera, renderer, lights and controls and starts the animation
 */
function init() {

    // Rhino models are z-up, so set this as the default
    THREE.Object3D.DefaultUp = new THREE.Vector3( 0, 0, 1 );

    // create a scene and a camera
    scene = new THREE.Scene()
    scene.background = new THREE.Color(1, 1, 1)
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000)
    camera.position.set(1, -1, 1) // like perspective view

    // very light grey for background, like rhino
    scene.background = new THREE.Color('whitesmoke')

    // create the renderer and add it to the html
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio( window.devicePixelRatio )
    renderer.setSize(window.innerWidth, window.innerHeight)
    document.body.appendChild(renderer.domElement)

    // add some controls to orbit the camera
    controls = new OrbitControls(camera, renderer.domElement)

    // add a directional light
    const directionalLight = new THREE.DirectionalLight( 0xffffff )
    directionalLight.intensity = 2
    scene.add( directionalLight )

    const ambientLight = new THREE.AmbientLight()
    scene.add( ambientLight )

    // handle changes in the window size
    window.addEventListener( 'resize', onWindowResize, false )

    animate()
}

/**
 * Call appserver
 */
async function compute() {
  // construct url for GET /solve/definition.gh?name=value(&...)
  const url = new URL('/solve/' + data.definition.replace(/\?/g, '^'), window.location.origin)
  Object.keys(data.inputs).forEach(key => url.searchParams.append(key, data.inputs[key]))
  console.log(url.toString())
  
  try {
    const response = await fetch(url)
  
    if(!response.ok) {
      // TODO: check for errors in response json
      throw new Error(response.statusText)
    }

    const responseJson = await response.json()
    console.log(responseJson)

    collectResults(responseJson)

  } catch(error) {
    console.error(error)
  }
}

function updateMarkdownAndTags() {
  // Get markdown and tags from data attributes
  const container = document.getElementById('container');
  //const markdownString = container.getAttribute('data-markdown');
  //const tags = JSON.parse(container.getAttribute('data-tags'));

  const markdownString = container.getAttribute('data-markdown');
  const tags = container.getAttribute('data-tags').split(',')

  // Get markdown and tags boxes
  const markdownBox = document.getElementById('markdown-box');
  const tagsBox = document.getElementById('tags-box');
/*
  // Render markdown
  const markdownHtml = marked(markdownString);
  document.getElementById('markdown-box').innerHTML = markdownHtml;

  // Render tags
  const tagsContainer = document.getElementById('tags-box');
  tagsContainer.innerHTML = ''; // Clear any existing tags
  tags.forEach(tag => {
      const tagElement = document.createElement('span');
      tagElement.textContent = tag;
      tagsContainer.appendChild(tagElement);
  });
*/
  // Handle markdown box
  if (markdownString.trim().length > 0) {
    const markdownHtml = marked(markdownString);
    markdownBox.innerHTML = markdownHtml;
    markdownBox.style.display = 'block';  // Ensure it's visible
  } else {
      markdownBox.style.display = 'none';  // Hide the box if markdownString is empty
  }

  // Handle tags box
  if (tags.length > 0 && tags[0].trim().length > 0) {
      tagsBox.innerHTML = '';  // Clear any existing tags
      tags.forEach(tag => {
          const tagElement = document.createElement('span');
          tagElement.textContent = tag.trim();  // Trim any extra spaces
          tagsBox.appendChild(tagElement);
      });
      tagsBox.style.display = 'block';  // Ensure it's visible
  } else {
      tagsBox.style.display = 'none';  // Hide the box if no tags
  }
}

/**
 * Parse response
 */
function collectResults(responseJson) {

    const values = responseJson.values

    // clear doc
    if( doc !== undefined)
        doc.delete()

    //console.log(values)
    doc = new rhino.File3dm()

    // for each output (RH_OUT:*)...
    for ( let i = 0; i < values.length; i ++ ) {
      // ...iterate through data tree structure...
      for (const path in values[i].InnerTree) {
        const branch = values[i].InnerTree[path]
        // ...and for each branch...
        for( let j = 0; j < branch.length; j ++) {
          // ...load rhino geometry into doc
          const rhinoObject = decodeItem(branch[j])
          //console.log(rhinoObject.vertexColors().count)
          if (rhinoObject !== null) {

            if( rhinoObject.constructor.name === 'File3dm' ) {
              
              const _doc = rhinoObject

              //add objects into the main doc
              for( let p = 0; p < _doc.objects().count; p ++ ) {

                const ro = _doc.objects().get(p)
                const geo = ro.geometry()
                const attr = ro.attributes()
                const matIndex = attr.materialIndex
                const mat = _doc.materials().get(matIndex)
                attr.materialIndex = doc.materials().count - 1 
                doc.materials().add(mat)
                doc.objects().add(geo, attr)

              }
              
            } else {
              doc.objects().add(rhinoObject, null)
            }
            
          }
        }
      }
    }

    if (doc.objects().count < 1) {
      console.error('No rhino objects to load!')
      showSpinner(false)
      return
    }

    // load rhino doc into three.js scene
    const buffer = new Uint8Array(doc.toByteArray()).buffer
    loader.parse( buffer, function ( object ) 
    {
        // debug 
        /*
        object.traverse(child => {
          if (child.material !== undefined)
            child.material = new THREE.MeshNormalMaterial()
        }, false)
        */

        // clear objects from scene. do this here to avoid blink
        scene.traverse(child => {
            if (!child.isLight) {
                scene.remove(child)
            }
        })

        //console.log(object)

        // add object graph from rhino model to three.js scene
        scene.add( object )

        // hide spinner and enable download button
        showSpinner(false)

        // zoom to extents
        zoomCameraToSelection(camera, controls, scene.children)
    })
}

/**
 * Attempt to decode data tree item to rhino geometry
 */
function decodeItem(item) {
  const data = JSON.parse(item.data)
  if (item.type === 'System.String') {
    // hack for draco meshes
    try {

        const obj = rhino.DracoCompression.decompressBase64String(data)

        if( obj === null ) {

          //might be a whole doc

          const arr = _base64ToArrayBuffer(data)
          return rhino.File3dm.fromByteArray(arr)

        } else {

          return obj

        }
        
    } catch {} // ignore errors (maybe the string was just a string...)
  } else if (typeof data === 'object') {
    //console.log(data)
    return rhino.CommonObject.decode(data)
  }
  return null
}

/**
 * Called when a slider value changes in the UI. Collect all of the
 * slider values and call compute to solve for a new scene
 */
function onSliderChange () {
  showSpinner(true)
  // get slider values
  let inputs = {}
  for (const input of document.getElementsByTagName('input')) {
    switch (input.type) {
    case 'number':
      inputs[input.id] = input.valueAsNumber
      break
    case 'range':
      inputs[input.id] = input.valueAsNumber
      break
    case 'checkbox':
      inputs[input.id] = input.checked
      break
    }
  }
  
  data.inputs = inputs

  compute()
}

/**
 * The animation loop!
 */
function animate() {
  requestAnimationFrame( animate )
  controls.update()
  renderer.render(scene, camera)
}

/**
 * Helper function for window resizes (resets the camera pov and renderer size)
  */
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize( window.innerWidth, window.innerHeight )
  animate()
}

/**
 * Helper function that behaves like rhino's "zoom to selection", but for three.js!
 */
function zoomCameraToSelection( camera, controls, selection, fitOffset = 1.2 ) {
  
  const box = new THREE.Box3();
  
  for( const object of selection ) {
    if (object.isLight) continue
    box.expandByObject( object );
  }
  
  const size = box.getSize( new THREE.Vector3() );
  const center = box.getCenter( new THREE.Vector3() );
  
  const maxSize = Math.max( size.x, size.y, size.z );
  const fitHeightDistance = maxSize / ( 2 * Math.atan( Math.PI * camera.fov / 360 ) );
  const fitWidthDistance = fitHeightDistance / camera.aspect;
  const distance = fitOffset * Math.max( fitHeightDistance, fitWidthDistance );
  
  const direction = controls.target.clone()
    .sub( camera.position )
    .normalize()
    .multiplyScalar( distance );
  controls.maxDistance = distance * 10;
  controls.target.copy( center );
  
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  camera.position.copy( controls.target ).sub(direction);
  
  controls.update();
  
}

/**
 * This function is called when the download button is clicked
 */
function download () {
    // write rhino doc to "blob"
    const bytes = doc.toByteArray()
    const blob = new Blob([bytes], {type: "application/octect-stream"})

    // use "hidden link" trick to get the browser to download the blob
    const filename = data.definition.replace(/\.gh$/, '') + '.3dm'
    const link = document.createElement('a')
    link.href = window.URL.createObjectURL(blob)
    link.download = filename
    link.click()
}

/**
 * Shows or hides the loading spinner
 */
function showSpinner(enable) {
  if (enable)
    document.getElementById('loader').style.display = 'block'
  else
    document.getElementById('loader').style.display = 'none'
}

// from https://stackoverflow.com/a/21797381
function _base64ToArrayBuffer(base64) {
  var binary_string = window.atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}