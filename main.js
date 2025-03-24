import {Feature, Map as OLMap, Overlay, View} from 'ol';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import OSM from 'ol/source/OSM';
import GPX from 'ol/format/GPX.js';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON.js';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style.js';
import  proj4  from 'proj4/dist/proj4';
import { register } from 'ol/proj/proj4';
import { Circle } from 'ol/geom';
import TileSource from 'ol/source/Tile';
import XYZ from 'ol/source/XYZ';
import * as olProj from 'ol/proj'
import { Html5QrcodeScanner } from 'html5-qrcode';
import { openDB, deleteDB, wrap, unwrap } from 'idb';
import {bbox as bboxStrategy} from 'ol/loadingstrategy.js';
import FileSaver from 'file-saver';
import { deleteFileFromWFS, downloadFileFromWFS, fetchWfsFileMetadata, fetchWithCreds, uploadFileToWfs } from './wfs_file_store';
import { feature_id_property, feature_wfs_name, file_wfs_name, geoserver_address, namespace } from './config';
import { ISOXMLManager, Partfield } from 'isoxml';
import ImageLayer from 'ol/layer/Image';
import chroma from "chroma-js";
import {  GridGridTypeEnum } from "isoxml";
import Static from 'ol/source/ImageStatic';
import { renderFeatureInfoPanel } from './info_panel';


let isOnline = false;

document.getElementById("loginBtn").onclick = e => {
  const user = document.getElementById("user").value;
  const pwd = document.getElementById("pwd").value;

  localStorage.setItem('lastUser', user); 

  initMap(user, pwd);
}

try {  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 1000);
  const isOnlineReq = await fetch(geoserver_address + '/geoserver/wfs?service=WFS&version=1.1.0&request=GetCapabilities',
                             { signal: controller.signal });
  clearTimeout(id);
  const isOnlineResult = await isOnlineReq.text();
  isOnline = true;
} catch(e) {
  isOnline = false;
}


if(!isOnline) {
  const lastUser = localStorage.getItem("lastUser");
  initMap(lastUser);
}

async function initMap(user, password) {
  const loginDiv = document.getElementById("loginDiv");
  loginDiv.parentNode.removeChild(loginDiv);

  const idb = await openDB('hofapp', 20, {
    upgrade(db, oldVersion, newVersion, transaction, event) {
      if(db.objectStoreNames.contains("imgs")) {
        db.deleteObjectStore('imgs');
      }
      if(db.objectStoreNames.contains("txt")) {
        db.deleteObjectStore("txt");
      }
      if(db.objectStoreNames.contains("file")) {
        db.deleteObjectStore("file");
      }
      const imgStore = db.createObjectStore('imgs',  { keyPath: 'url' });
      imgStore.createIndex("url", "url");
      const txtStore = db.createObjectStore('txt',  { keyPath: 'url' });
      txtStore.createIndex("url", "url");
      const fileStore = db.createObjectStore('file',  { keyPath : 'filename' });
      fileStore.createIndex("filename", "filename");
      fileStore.createIndex(feature_id_property, feature_id_property, {unique : false});
      fileStore.createIndex("uploadpending", "uploadpending", {unique : false});
      fileStore.createIndex("removalpending", "removalpending", {unique : false})
    }
  });

  function fetchWithCredsPrefilled(resource, options = {}) {
    return fetchWithCreds(user, password, resource, options);
  }

  async function fetchTextIdbCached(fetchFun, resource, options) {
    if(!isOnline) {
      const txtStore = idb.transaction('txt', 'readonly').objectStore('txt');
      // const txtUrlIdx = txtStore.index('url');
      // const range = IDBKeyRange.only(resource);
      // const cursor = await txtUrlIdx.openCursor(range);
      return (await txtStore.get(resource)).data;
    } else {
      const fetchResTxt = await (await fetchFun(resource, options)).text();
      const txtStore = idb.transaction('txt', 'readwrite').objectStore('txt');
      txtStore.put({url : resource, data : fetchResTxt});
      return fetchResTxt;
    }
}

  async function loadGPXFromFiles(map, gpxLayer) {
    const gpxs = [];
    if(isOnline) {
      const gpxReq = await fetchTextIdbCached(fetchWithCredsPrefilled, geoserver_address + '/geoserver/wfs/?service=WFS&version=2.0.0&request=GetFeature&typeNames=' + file_wfs_name + '&cql_filter=mimetype=%27application%2Fgpx%2Bxml%27&outputformat=json')
      const gpxjs = JSON.parse(gpxReq);
      for(const gpxft of gpxjs["features"]) {
        gpxs.push(gpxft.properties.fdata);
      }

    } else {
      //TODO: Store mimetype in idb instead of full scan
      const allFiles = await idb.transaction('file', 'readonly').objectStore('file').index('removalpending').getAll(IDBKeyRange.only(0))
      const gpxFiles = allFiles.filter(dbfile => dbfile.filename.indexOf(".gpx") > -1);
      for(const gpx of gpxFiles) {
        let b64gpx = await blobToBase64(gpx.blob);
        b64gpx = b64gpx.substring(b64gpx.indexOf(',') + 1);
        gpxs.push(b64gpx);
      }
    }
    
    gpxLayer.getSource().clear();
    for(const gpx of gpxs) {
      const gpxDecoded = (window.atob(gpx));
      const GPXfeatures = gpxLayer.getSource().getFormat().readFeatures(gpxDecoded, {featureProjection : map.getView().getProjection()});
      gpxLayer.getSource().addFeatures(GPXfeatures);
    }
  }

  function calculateGridValuesRange (
    grid,
    treatmentZones
) {

    let min = +Infinity
    let max = -Infinity

    if (grid.attributes.GridType === GridGridTypeEnum.GridType1) {
        const zoneCodes = grid.getAllReferencedTZNCodes()

        zoneCodes.forEach(zoneCode => {
            const zone = treatmentZones.find(z => z.attributes.TreatmentZoneCode === zoneCode)
            const pdv = zone?.attributes.ProcessDataVariable?.[0]

            if (pdv) {
                const value = pdv.attributes.ProcessDataValue

                if (value) {
                    min = Math.min(min, value)
                    max = Math.max(max, value)
                }
            }
        })
    } else {
        const nCols = grid.attributes.GridMaximumColumn
        const nRows = grid.attributes.GridMaximumRow
        const cells = new Int32Array(grid.binaryData.buffer)

        for (let idx = 0; idx < nRows * nCols; idx++) {
            const v = cells[idx]
            if (v) {
                min = Math.min(min, cells[idx])
                max = Math.max(max, cells[idx])
            }
        }
    }

    // if we don't update min value, then all the values in the grid were zeros
    if (min === +Infinity) {
        return {min: 0, max: 0}
    }

    return {min, max}
}

  function gridToImage(grid, range) {
    const nCols = grid.attributes.GridMaximumColumn;
    const nRows = grid.attributes.GridMaximumRow;

    const canvas = document.createElement('canvas')
    canvas.width = nCols
    canvas.height = nRows

    const GRID_COLOR_SCALE = chroma.scale(chroma.brewer.RdYlGn.slice(0).reverse())

    const palette = chroma.scale((GRID_COLOR_SCALE.colors)()).domain([range.min, range.max])

    const ctx = canvas.getContext('2d')
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    if (grid.attributes.GridType === GridGridTypeEnum.GridType1) {
        const valueTable = {}

        treatmentZones.forEach(zone => {
            const code = zone.attributes.TreatmentZoneCode
            const value = zone.attributes.ProcessDataVariable?.[0]?.attributes.ProcessDataValue

            valueTable[code] = value
        })

        const cells = new Uint8Array(grid.binaryData.buffer)

        for (let y = 0; y < nRows; y++) {
            for (let x = 0; x < nCols; x++) {
                const code = cells[y * nCols + x]
                const value = valueTable[code]
                if (value === 0 || value === undefined) {
                    continue
                }
                const color = palette(value).rgba()
                const idx = 4 * ((nRows - y - 1) * nCols + x)

                imageData.data[idx + 0] = color[0]
                imageData.data[idx + 1] = color[1]
                imageData.data[idx + 2] = color[2]
                imageData.data[idx + 3] = 255
            }
        }

    } else {
        const cells = new Int32Array(grid.binaryData.buffer)

        for (let y = 0; y < nRows; y++) {
            for (let x = 0; x < nCols; x++) {
                const v = cells[y * nCols + x]
                if (v === 0) {
                    continue
                }
                const color = palette(v).rgba()
                const idx = 4 * ((nRows - y - 1) * nCols + x)

                imageData.data[idx + 0] = color[0]
                imageData.data[idx + 1] = color[1]
                imageData.data[idx + 2] = color[2]
                imageData.data[idx + 3] = 255
            }
        }
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas.toDataURL();
  }


  async function loadIsoXmlFromFiles(map, isoXmlLayer) {
    const isoxmlManager = new ISOXMLManager();

    const isoXmls = [];
    if(isOnline) {
      const xmlReq = await fetchTextIdbCached(fetchWithCredsPrefilled, geoserver_address + '/geoserver/wfs/?service=WFS&version=2.0.0&request=GetFeature&typeNames=' + file_wfs_name + '&cql_filter=mimetype=%27application%2Fisoxml%27&outputformat=json')
      const gpxjs = JSON.parse(xmlReq);
      for(const gpxft of gpxjs["features"]) {
        isoXmls.push(gpxft.properties.fdata);
      }

    } else {
      //TODO: Store mimetype in idb instead of full scan
      const allFiles = await idb.transaction('file', 'readonly').objectStore('file').index('removalpending').getAll(IDBKeyRange.only(0))
      const gpxFiles = allFiles.filter(dbfile => dbfile.filename.indexOf(".isoxml") > -1);
      for(const isoXml of gpxFiles) {
        let b64xml = await blobToBase64(isoXml.blob);
        b64xml = b64xml.substring(b64xml.indexOf(',') + 1);
        isoXmls.push(b64xml);
      }
    }
    
    isoXmlLayer.getSource().clear();
    isoXmlGridLayers.forEach(l => map.removeLayer(l));
    isoXmlGridLayers.length = 0;
    for(const xml of isoXmls) {
      const binary = Uint8Array.from(atob(xml), c => c.charCodeAt(0))
      isoxmlManager.parseISOXMLFile(binary.buffer, 'application/zip').then(() => {
          // get all the Partfileds
        const partfields = isoxmlManager.rootElement.attributes.Partfield || []

        const tasksWithGrid = isoxmlManager.rootElement.attributes.Task.filter(task => task.attributes.Grid.length > 0);
        for(const task of tasksWithGrid) {
          const grid = task.attributes.Grid[0];
          const gridAttributes = grid.attributes;
          const gridRange = calculateGridValuesRange(grid, task.attributes.TreatmentZone || [])
          const gridImageUrl = gridToImage(grid, gridRange);
        
          const extent = [gridAttributes.GridMinimumEastPosition, 
            gridAttributes.GridMinimumNorthPosition,
            gridAttributes.GridMinimumEastPosition + gridAttributes.GridCellEastSize * gridAttributes.GridMaximumColumn,
            gridAttributes.GridMinimumNorthPosition + gridAttributes.GridCellNorthSize * gridAttributes.GridMaximumRow
          ];

          const imageLayer = new ImageLayer({
            source: new Static({
                url: gridImageUrl,
                projection: 'EPSG:4326',
                imageExtent: extent,
                interpolate: false
            })
        });
        isoXmlGridLayers.push(imageLayer);
        map.addLayer(imageLayer);
        

        }

        // print designators of all the Partfields
        partfields.forEach(partfield => {
            const geoJson = partfield.toGeoJSON();
            const features = isoXmlLayer.getSource().getFormat().readFeatures(geoJson, {featureProjection : map.getView().getProjection()});
            isoXmlLayer.getSource().addFeatures(features);



        // 4. Fit the map to the new extent (important!)
        // map.getView().fit(isoXmlLayer.getSource().getExtent());

            console.log(geoJson);
        })
      });
    }
  }




  // // 1. load user data
  // const userUrl  = 'https://192.168.56.101:8443/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=wfsttest:wfsuser_view&outputFormat=application/json';
  // const resp = await fetchTextIdbCached(fetchWithCredsPrefilled, userUrl);
  // const userDetails = (JSON.parse(resp)).features[0].properties;

  const gpxLayer = new VectorLayer({
    source: new VectorSource({
       format: new GPX(),
    }),
  });

  const isoXmlLayer = new VectorLayer({
    source: new VectorSource({
       format: new GeoJSON(),
    }),
  });
  isoXmlLayer.setZIndex(-1);


  const isoXmlGridLayers = [];


  
proj4.defs("EPSG:31287","+proj=lcc +lat_0=47.5 +lon_0=13.3333333333333 +lat_1=49 +lat_2=46 +x_0=400000 +y_0=400000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs +type=crs");
proj4.defs("EPSG:4326","+proj=longlat +datum=WGS84 +no_defs +type=crs");
proj4.defs("EPSG:3035","+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs");
register(proj4); 


// const userGeometriesReq = await fetchWithCreds("https://192.168.56.101:8443/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=wfsttest:protectedsite_view&outputFormat=application/json&srsname=EPSG:31287")
// const userGeometries = await userGeometriesReq.text();

const userGeometries = await fetchTextIdbCached(fetchWithCredsPrefilled, geoserver_address + "/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=" + feature_wfs_name + "&outputFormat=application/json&srsname=EPSG:31287");
const vectorSource = new VectorSource({
   features: new GeoJSON().readFeatures(userGeometries, {featureProjection: 'EPSG:31287', dataProjection: 'EPSG:31287'}),
});

const vectorLayer = new VectorLayer({
  source: vectorSource,
  style: {
    'stroke-width': 0.75,
    'stroke-color': 'white',
    'fill-color': 'rgba(255,0,0,0.5)',
  }});

const map = new OLMap({
  target: 'map',
  layers: [
    new TileLayer({
      source : new XYZ({
        url : "https://mapproxy.rest-gdi.geo-data.space/tiles/osm/webmercator/{z}/{x}/{y}.png",
        maxZoom : 19,
        tileLoadFunction : async function(imageTile, src) {
          const img = imageTile.getImage();

          // const imgStore = idb.transaction('imgs', 'readonly').objectStore('imgs').get(src);
          // const imgUrlIdx = imgStore.index('url');
          // const range = IDBKeyRange.only(src);

          
          const imgData = (await idb.transaction('imgs', 'readonly').objectStore('imgs').get(src))?.data;
          if(imgData) {
              img.src = imgData;
          } else {
            img.src = src;
            const response = await fetch(src);
            const blobResp = await response.blob();
            const reader = new FileReader();
            reader.onload = e => {
              const imgStore = idb.transaction('imgs', 'readwrite').objectStore('imgs');
              imgStore.put({url : src, data : reader.result});
            }
            reader.readAsDataURL(blobResp);
          }
        }
      })
    }),
    vectorLayer,
    gpxLayer,
    isoXmlLayer
  ],
  view: new View({
    center: [401306 , 423398],
    zoom: 8,
    projection: 'EPSG:31287'
  })
});


map.getView().fit(vectorSource.getExtent());  

// In case a previous map state is found in localStorage, restore it
//const center = localStorage.getItem('center');
//const zoom = localStorage.getItem('zoom');
// if(center) {
//   map.getView().setCenter(JSON.parse(center));
// }
//if(zoom) {
//  map.getView().setZoom(JSON.parse(zoom));
//}

map.getView().on('change', e => {
  const center = map.getView().getCenter();
  const zoom = map.getView().getZoom();
  localStorage.setItem('center', JSON.stringify(center)); 
  localStorage.setItem('zoom', JSON.stringify(zoom)); 
  //const tx = idb.transaction(['toDoList'], 'readwrite');
})


const container = document.getElementById('popup');
const content = document.getElementById('popup-content');
const closer = document.getElementById('popup-closer');

  const overlay = new Overlay({
    element: container,
    autoPan: {
      animation: {
        duration: 250,
      },
    },
  });
  map.addOverlay(overlay)

  async function downloadFile(fileName) {
    if(isOnline) {
        return downloadFileFromWFS(geoserver_address, file_wfs_name, user, password, fileName);
    } else {
      const fileStore = idb.transaction('file', 'readonly').objectStore('file');
      const cursor = await fileStore.index('filename').openCursor(IDBKeyRange.only(fileName));
      if(cursor) {
        const entry = cursor?.value;
        return new File([entry.blob], fileName);
      }
    }
  }
  
  async function deleteFile(filename) {
    if(isOnline) {
      await deleteFileFromWFS(geoserver_address, file_wfs_name, user, password, filename);
      idb.transaction('file', 'readwrite').objectStore('file').delete(filename);
    } else {
      const dbFile = await idb.transaction('file', 'readonly').objectStore('file').get(filename);
      dbFile.removalpending = 1;
      idb.transaction('file', 'readwrite').objectStore('file').put(dbFile);
    }
  }


async function syncFiles() {
  // sync locally cached uploads
  let fileStore = idb.transaction('file', 'readonly').objectStore('file');
  const pendingUploads = await fileStore.index('uploadpending').getAll(IDBKeyRange.only(1));
  for (const dbfile of pendingUploads) {
    const file = new File([dbfile.blob], dbfile.filename);
    await uploadFileToWfs(namespace, geoserver_address, file_wfs_name, user, password, dbfile[feature_id_property], dbfile.filename, dbfile.filesize, dbfile.mimetype, dbfile.userids, file)
    //set cached entry to not pending
    dbfile.uploadpending = 0;
    idb.transaction('file', 'readwrite').objectStore('file').put(dbfile);
  }

  // sync locally cached deletes
  fileStore = idb.transaction('file', 'readonly').objectStore('file');
  const pendingRemovals = await fileStore.index('removalpending').getAll(IDBKeyRange.only(1));
  for (const dbfile of pendingRemovals) {
    await deleteFile(dbfile.filename);
  }

  // re-read remote and local state again
  const filesRemote = await fetchWfsFileMetadata(geoserver_address, file_wfs_name, user, password);
  const remoteNameFileMap = new Map(filesRemote.map((remFile) => [remFile.filename, remFile]));
  const localFiles = await idb.transaction('file', 'readonly').objectStore('file').getAll();
  const localNameFileMap = new Map(localFiles.map(dbfile => [dbfile.filename, dbfile]));

  // download files which are present remotly, but not locally
  const filesMissingLocallyMap = new Map(remoteNameFileMap);
  localNameFileMap.forEach(dbfile => filesMissingLocallyMap.delete(dbfile.filename));
  for(const [fileName, fileMetaData] of filesMissingLocallyMap){
    const file = await downloadFile(fileName);
    let storedObj = {
      ...fileMetaData,
      uploadPending : 0,
      blob : file
    };
    storedObj[feature_id_property] = fileMetaData.objectid,

    idb.transaction('file', 'readwrite').objectStore('file').put(storedObj);
  }

  // delete files from local storage which are no longer present remote (deleted by other client)
  const fileMissingRemoteMap = new Map(localNameFileMap);
  remoteNameFileMap.forEach(dbfile => fileMissingRemoteMap.delete(dbfile.filename));
  for(const fileName of fileMissingRemoteMap.keys()) {
    idb.transaction('file', 'readwrite').objectStore('file').delete(fileName);
  }
}

if(isOnline) {
  await syncFiles();
}


loadGPXFromFiles(map, gpxLayer);

async function createFileContents(feature, id, content, coordinate) {
  let files = [];
  if(isOnline) {
    files = await fetchWfsFileMetadata(geoserver_address, file_wfs_name, user, password, id);
  } else {
    const fileStore = idb.transaction('file', 'readonly').objectStore('file');
    const fileGidIdx = fileStore.index(feature_id_property);
    const range = IDBKeyRange.only(id);
    for await (const cursor of fileGidIdx.iterate(range)) {
      const dbFile = cursor.value;
      if(!dbFile.removalpending) {
        files.push(dbFile);
      }
    }
  }
 
  content.innerHTML = `
  <div style="margin-top: 10px"><b>Dateien:</b></div>
  <table id="fileTable" class="fileTable"> 
  <tr>
  <th align=left>Dateiname</th>
  <th align=left></th>
  <th align=left>Berechtigt</th>
  <th align=left>Sync</th>
  </tr>
  </table>`;

  const table = document.getElementById("fileTable");
  for(let file of files) {
    const trFile = document.createElement("tr");
    table.append(trFile);

    const tdLink = document.createElement("td");
    trFile.append(tdLink);
    const downloadLink = document.createElement("a");
    downloadLink.innerText = `${file.filename} (${file.filesize})`;
    downloadLink.setAttribute("href", "#");
    downloadLink.onclick = async e => { 
      const data = await downloadFile(file.filename); 
      FileSaver.saveAs(data, file.filename, 'application/octet_stream');
      e.preventDefault(); 
    }
    tdLink.appendChild(downloadLink);

    const tdDelete = document.createElement("td");
    trFile.append(tdDelete);

    // Non-owners will only reveive empty permission data
    if(file.userids && file.userids.length > 0)
    {
      const deleteLink = document.createElement("a");
      deleteLink.innerHTML = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAmJLR0QA/4ePzL8AAAAHdElNRQfoCAYQKB0BpUZRAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI0LTA4LTA2VDE2OjQwOjI4KzAwOjAw9vSFoAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNC0wOC0wNlQxNjo0MDoyOCswMDowMIepPRwAAAHISURBVEhL7Za9rgFREMf/u66IBokoREFBg4hK4xkIIjwD8QIKD6DQikqr1BOlhyDRqDQEkUh83p25Z5e91+5eN3T3l5zMzJ7dM2dmz8yudFXAG/mVg0qlgtVqBZvNxvblcoHD4UCn04HT6eRrRlg68Hq9vLgRVvuThXzIdDrlxUulEi90P5rNJt/T6/VYGqGLYDabwW63s+7xeFAoFDAajTAejxGJRHA4HHhOlmW+z+fzIRAIYDKZYLlc8tzpdEIwGNTSSbthut0uOXrJqFarYtXrVYtgPp+j3W6j3+9zahqNBs7nM6fDCpfLhXq9DrfbjVqthmw2i1Qq9TVJDu4pl8u8i2ehZ8LhsLBu/HjJap7/AkX8HdNTtFgsIEkSWq0W28lkkm1iOByyPhgM2DbC1MFut2O5Xq91klD1zWbD0ghTB3Qc76V29BRU/f7aI0wdvIJ/B5aYOlDPtVob+/2eJXE8HnXSCFMHfr8fiUQC6XSabaXKkclkWI/FYojH44hGo2wbIipaI5/P/7lVhEIhYd146Tt4VBMfQmpQCqijUq+nFNHn0QxqF9vtlvVcLsdSh4hER7FY5JCfGUp7Fk/reftfxZvrAPgEzoWq38Rr1WYAAAAASUVORK5CYII="/>';
      deleteLink.setAttribute("href", "#");
      deleteLink.onclick = async (e) => { e.preventDefault(); 
          await deleteFile(file.filename); 
          setTimeout(() => createFileContents(feature, id, content, coordinate), 100)
        }
      tdDelete.appendChild(deleteLink);
      //content.appendChild(document.createElement("br"));
    }

    const tdRights = document.createElement("td");
    trFile.append(tdRights);
    tdRights.innerText = file.userids;

    const tdSync = document.createElement("td");
    trFile.append(tdSync);
    tdSync.innerText = file.uploadpending ? 'N' : 'Y';
  }

  //Also re-create gpx layer when file content changed
  loadGPXFromFiles(map, gpxLayer);
  loadIsoXmlFromFiles(map, isoXmlLayer);
  
  if(feature.get("owner") == localStorage.getItem("lastUser")) {
    const fileInput =  document.createElement("input", {id : "fileInput"});
    fileInput.setAttribute("type", "file");
    content.appendChild(fileInput);

    fileInput.addEventListener('change', async e => {
      var file = e.target.files[0];
      let mimetype = "application/octet-stream";
      
      const lowerCaseFileName = file.name.toLowerCase();
      if(lowerCaseFileName.endsWith(".gpx")) {
        mimetype = "application/gpx+xml";
      } else if (lowerCaseFileName.endsWith(".isoxml")) {
        mimetype = "application/isoxml";
      }

      let userIds = window.prompt('Beistrich-getrennte Liste von zusätzlich leseberechtigten Benutzern:');
      if(userIds) {
        userIds += ","
      }
      userIds += localStorage.getItem('lastUser'); //uploading user is always owner

      const rawBytes = await file.arrayBuffer();
      if(isOnline) {
        await uploadFileToWfs(namespace, geoserver_address, file_wfs_name, user, password, id, file.name, rawBytes.byteLength, mimetype, userIds, file);
      }

      // Upload file to local store too
      const blob = new Blob([rawBytes], { type: mimetype });
      const fileStore = idb.transaction('file', 'readwrite').objectStore('file');
      let storedObj = {
        uploadpending : isOnline ? 0 : 1, //TODO - set to  true in case upload succeeds
        removalpending : 0,
        // gid : id,
        mimetype : mimetype,
        filesize : rawBytes.byteLength,
        filename : file.name,
        userids : userIds,
        blob : blob
      };
      storedObj[feature_id_property] = id;
      fileStore.put(storedObj);

        createFileContents(feature, id, content, coordinate)
    });

  }

  overlay.setPosition(coordinate);
}

  map.on('click', async function(evt) {
    map.forEachFeatureAtPixel(evt.pixel,
      async function(feature, layer) {
        if(layer === vectorLayer) 
        {
          const props = feature.getProperties();
          const id = props[feature_id_property];

          content.innerHTML = `
            <div id="attrs">
            <b>Eigenschaften:</b>
            <table id="attrTable" class="fileTable"> 
            <tr>
            <th align=left>Eigenschaft</th>
            <th align=left>Wert</th>
            </tr>
            </table>
            </div>
            <div id="files" />`
            ;

            const filesDiv = document.getElementById("files");

            let attrRows = await renderFeatureInfoPanel(feature);
            document.getElementById("attrTable").innerHTML = attrRows;

          createFileContents(feature, id, filesDiv, evt.coordinate);
      }
    })
  });


    /**
   * Add a click handler to hide the popup.
   * @return {boolean} Don't follow the href.
   */
    closer.onclick = function() {
      overlay.setPosition(undefined);
      closer.blur();
      return false;
    };
}