import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader';
import rhino3dm from 'rhino3dm';
import { RhinoCompute } from 'rhino_compute';

// set up loader for converting the results to threejs
const loader = new Rhino3dmLoader();
loader.setLibraryPath('https://unpkg.com/rhino3dm@8.0.0-beta3/');

// initialise 'data' object that will be used by compute()
const data = {
  definition: definitionName,
  inputs: getInputs(),
};

// globals
let doc, scene, camera, renderer, controls;
let useGhostedView = false; // Add a flag to toggle ghosted view

const rhino = await rhino3dm();
console.log('Loaded rhino3dm.');

init();
compute();
await updateMarkdownAndTags();

/**
 * Gets <input> elements from html and sets handlers
 * (html is generated from the grasshopper definition)
 */
function getInputs() {
  const inputs = {};
  for (const input of document.getElementsByTagName('input')) {
    switch (input.type) {
      case 'number':
        inputs[input.id] = input.valueAsNumber;
        input.onchange = onSliderChange;
        break;
      case 'range':
        inputs[input.id] = input.valueAsNumber;
        input.onmouseup = onSliderChange;
        input.ontouchend = onSliderChange;
        break;
      case 'checkbox':
        inputs[input.id] = input.checked;
        input.onclick = onSliderChange;
        break;
      default:
        break;
    }
  }
  return inputs;
}

/**
 * Sets up the scene, camera, renderer, lights and controls and starts the animation
 */
function init() {
  // Rhino models are z-up, so set this as the default
  THREE.Object3D.DefaultUp = new THREE.Vector3(0, 0, 1);

  // create a scene and a camera
  scene = new THREE.Scene();
  scene.background = new THREE.Color(1, 1, 1);
  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    1,
    1000
  );
  camera.position.set(1, -1, 1); // like perspective view

  // very light grey for background, like rhino
  scene.background = new THREE.Color('whitesmoke');

  // create the renderer and add it to the html
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  camera.up.set(0, 0, 1); // Make sure Z is the up direction

  // add some controls to orbit the camera
  controls = new OrbitControls(camera, renderer.domElement);

  // add a directional light
  const directionalLight = new THREE.DirectionalLight(0xffffff);
  directionalLight.intensity = 2;
  scene.add(directionalLight);

  const ambientLight = new THREE.AmbientLight();
  scene.add(ambientLight);

  // handle changes in the window size
  window.addEventListener('resize', onWindowResize, false);

  animate();
}

/**
 * Call appserver
 */
async function compute() {
  // construct url for GET /solve/definition.gh?name=value(&...)
  const url = new URL(
    '/solve/' + data.definition.replace(/\?/g, '^'),
    window.location.origin
  );
  Object.keys(data.inputs).forEach((key) =>
    url.searchParams.append(key, data.inputs[key])
  );
  console.log(url.toString());

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const responseJson = await response.json();
    console.log(responseJson);

    collectResults(responseJson);
  } catch (error) {
    console.error(error);
  }
}

/**
 * Update markdown and tags, and check for ghosted tag.
 */
function updateMarkdownAndTags() {
  // Get markdown and tags from data attributes
  const container = document.getElementById('container');
  const markdownString = container.getAttribute('data-markdown');
  const tags = container.getAttribute('data-tags').split(',');

  // Handle markdown box
  const markdownBox = document.getElementById('markdown-box');
  if (markdownString.trim().length > 0) {
    const markdownHtml = marked(markdownString);
    markdownBox.innerHTML = markdownHtml;
    markdownBox.style.display = 'block'; // Ensure it's visible
  } else {
    markdownBox.style.display = 'none'; // Hide the box if markdownString is empty
  }

  // Handle tags box
  const tagsBox = document.getElementById('tags-box');
  if (tags.length > 0 && tags[0].trim().length > 0) {
    tagsBox.innerHTML = ''; // Clear any existing tags
    tags.forEach((tag) => {
      const tagElement = document.createElement('span');
      tagElement.textContent = tag.trim(); // Trim any extra spaces
      tagsBox.appendChild(tagElement);
    });
    tagsBox.style.display = 'block'; // Ensure it's visible
  } else {
    tagsBox.style.display = 'none'; // Hide the box if no tags
  }

  // Check if ghosted mode is requested
  useGhostedView = tags.map(t => t.toLowerCase()).includes('ghosted');
}



/**
 * Parse response and apply ghosted material if requested.
 */
function collectResults(responseJson) {
  const values = responseJson.values;

  // Clear previous document if it exists
  if (doc !== undefined) doc.delete();

  doc = new rhino.File3dm();

  // For each output (RH_OUT:*)...
  for (let i = 0; i < values.length; i++) {
    for (const path in values[i].InnerTree) {
      const branch = values[i].InnerTree[path];
      for (let j = 0; j < branch.length; j++) {
        const rhinoObject = decodeItem(branch[j]);
        if (rhinoObject !== null) {
          if (rhinoObject.constructor.name === 'File3dm') {
            const _doc = rhinoObject;

            // Add objects into the main doc
            for (let p = 0; p < _doc.objects().count; p++) {
              const ro = _doc.objects().get(p);
              const geo = ro.geometry();
              const attr = ro.attributes();
              doc.objects().add(geo, attr);
            }
          } else {
            doc.objects().add(rhinoObject, null);
          }
        }
      }
    }
  }

  if (doc.objects().count < 1) {
    console.error('No rhino objects to load!');
    showSpinner(false);
    return;
  }

  // Load Rhino doc into Three.js scene
  const buffer = new Uint8Array(doc.toByteArray()).buffer;
  loader.parse(buffer, function (object) {
    // Clear existing objects
    scene.traverse((child) => {
      if (!child.isLight) {
        scene.remove(child);
      }
    });

    // Apply ghosted material if requested
    if (useGhostedView) {
      object.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshBasicMaterial({
            color: 0x000000,
            depthTest: false,
            opacity: 0.2, // Set the transparency level
            transparent: true,
            wireframe: false,
          });
           // Create and add edges as a separate LineSegments object
          const edges = new THREE.EdgesGeometry(child.geometry); // Get edges of the mesh
          const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x000000,           // White outline color
            linewidth: 1,              // Line width (doesn't affect much in WebGL)
          });

          const lineSegments = new THREE.LineSegments(edges, lineMaterial);
          child.add(lineSegments);      // Add edges to the mesh object
        }
      });
    }

    // Add object graph from Rhino model to Three.js scene
    scene.add(object);

    // Hide spinner and enable download button
    showSpinner(false);

    // Zoom to extents
    zoomCameraToSelection(camera, controls, scene.children);
  });
}

/**
 * Called when a slider value changes in the UI. Collect all of the
 * slider values and call compute to solve for a new scene
 */
function onSliderChange() {
  showSpinner(true);
  // get slider values
  let inputs = {};
  for (const input of document.getElementsByTagName('input')) {
    switch (input.type) {
      case 'number':
        inputs[input.id] = input.valueAsNumber;
        break;
      case 'range':
        inputs[input.id] = input.valueAsNumber;
        break;
      case 'checkbox':
        inputs[input.id] = input.checked;
        break;
    }
  }

  data.inputs = inputs;

  compute();
}

/**
 * The animation loop!
 */
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

/**
 * Helper function for window resizes (resets the camera pov and renderer size)
 */
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  animate();
}

/**
 * Helper function that behaves like rhino's "zoom to selection", but for three.js!
 */
function zoomCameraToSelection(camera, controls, selection, fitOffset = 1.2) {
  const box = new THREE.Box3();

  for (const object of selection) {
    if (object.isLight) continue;
    box.expandByObject(object);
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxSize = Math.max(size.x, size.y, size.z);
  const fitHeightDistance =
    maxSize / (2 * Math.atan((Math.PI * camera.fov) / 360));
  const fitWidthDistance = fitHeightDistance / camera.aspect;
  const distance = fitOffset * Math.max(fitHeightDistance, fitWidthDistance);

  const direction = controls.target
    .clone()
    .sub(camera.position)
    .normalize()
    .multiplyScalar(distance);
  controls.maxDistance = distance * 10;
  controls.target.copy(center);

  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  camera.position.copy(controls.target).sub(direction);

  controls.update();
}

/**
 * Shows or hides the loading spinner
 */
function showSpinner(enable) {
  if (enable) document.getElementById('loader').style.display = 'block';
  else document.getElementById('loader').style.display = 'none';
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

/**
 * Attempt to decode data tree item to rhino geometry
 */
function decodeItem(item) {
  const data = JSON.parse(item.data);
  if (item.type === 'System.String') {
    try {
      const obj = rhino.DracoCompression.decompressBase64String(data);

      if (obj === null) {
        const arr = _base64ToArrayBuffer(data);
        return rhino.File3dm.fromByteArray(arr);
      } else {
        return obj;
      }
    } catch {}
  } else if (typeof data === 'object') {
    return rhino.CommonObject.decode(data);
  }
  return null;
}
