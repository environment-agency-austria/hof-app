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
import QRCode from 'qrcode'
import { Html5QrcodeScanner } from 'html5-qrcode';
import { openDB, deleteDB, wrap, unwrap } from 'idb';
import {bbox as bboxStrategy} from 'ol/loadingstrategy.js';
import FileSaver from 'file-saver';

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
  const isOnlineReq = await fetch('https://192.168.56.101:8443/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=wfsttest:wfsuser_view&outputFormat=application/json',
                             { signal: controller.signal });
  clearTimeout(id);
  const isOnlineResult = await isOnlineReq.json();
  isOnline = true;
} catch(e) {
  isOnline = false;
}


if(!isOnline) {
  const lastUser = localStorage.getItem("lastUser");
  initMap(lastUser);
}


function readAsDataURL(file) {
  return new Promise((resolve, reject)=>{
    let fileReader = new FileReader();
    fileReader.onload = function(){
      return resolve({data:fileReader.result, name:file.name, size: file.size, type: file.type});
    }
    fileReader.readAsDataURL(file);
  })
}

function blobToBase64(blob) {
  return new Promise((resolve, _) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function initMap(user, password) {
  document.getElementById("loginDiv").innerHTML = '';

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
      fileStore.createIndex("gid", "gid", {unique : false});
      fileStore.createIndex("uploadpending", "uploadpending", {unique : false});
      fileStore.createIndex("removalpending", "removalpending", {unique : false})
    }
  });

  function fetchWithCreds(resource, options = {}) {
    options.headers = options.headers ?? {};
    options.headers['Authorization'] = `Basic ${window.btoa(user + ':' + password)}`;

    return fetch(resource, options);
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
      const gpxReq = await fetchTextIdbCached(fetchWithCreds, 'https://192.168.56.101:8443/geoserver/wfs/?service=WFS&version=2.0.0&request=GetFeature&typeNames=wfsttest:protectedsite_files_view&cql_filter=mimetype=%27application%2Fgpx%2Bxml%27&outputformat=json')
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

  // // 1. load user data
  // const userUrl  = 'https://192.168.56.101:8443/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=wfsttest:wfsuser_view&outputFormat=application/json';
  // const resp = await fetchTextIdbCached(fetchWithCreds, userUrl);
  // const userDetails = (JSON.parse(resp)).features[0].properties;

  const gpxLayer = new VectorLayer({
    source: new VectorSource({
       format: new GPX(),
    }),
  });

  
proj4.defs("EPSG:31287","+proj=lcc +lat_0=47.5 +lon_0=13.3333333333333 +lat_1=49 +lat_2=46 +x_0=400000 +y_0=400000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs +type=crs");
proj4.defs("EPSG:4326","+proj=longlat +datum=WGS84 +no_defs +type=crs");
proj4.defs("EPSG:3035","+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs");
register(proj4); 


// const userGeometriesReq = await fetchWithCreds("https://192.168.56.101:8443/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=wfsttest:protectedsite_view&outputFormat=application/json&srsname=EPSG:31287")
// const userGeometries = await userGeometriesReq.text();

const userGeometries = await fetchTextIdbCached(fetchWithCreds, "https://192.168.56.101:8443/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=wfsttest:protectedsite_view&outputFormat=application/json&srsname=EPSG:31287");
const vectorSource = new VectorSource({
   features: new GeoJSON().readFeatures(userGeometries),
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
    gpxLayer
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
const zoom = localStorage.getItem('zoom');
// if(center) {
//   map.getView().setCenter(JSON.parse(center));
// }
if(zoom) {
  map.getView().setZoom(JSON.parse(zoom));
}

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


function b64toFile(b64Data, filename, contentType) {
    var sliceSize = 512;
    var byteCharacters = atob(b64Data);
    var byteArrays = [];

    for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        var slice = byteCharacters.slice(offset, offset + sliceSize);
        var byteNumbers = new Array(slice.length);

        for (var i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        var byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    var file = new File(byteArrays, filename, {type: contentType});
    return file;
}

async function fetchWfsFileMetadata(gid) {
  let requestURL = 'https://192.168.56.101:8443/geoserver/wfs/?service=WFS&version=2.0.0&request=GetFeature&typeNames=wfsttest:protectedsite_files_view&propertyname=fid,psiteid,filename,filesize,mimetype,userids&outputformat=json';
  if(gid) {
    requestURL += '&cql_filter=psiteid='+gid;
  }
  const fileReq = await fetchWithCreds(requestURL)
  return (await fileReq.json()).features.map(ft => ft.properties);
}

async function syncFiles() {
  // sync locally cached uploads
  let fileStore = idb.transaction('file', 'readonly').objectStore('file');
  const pendingUploads = await fileStore.index('uploadpending').getAll(IDBKeyRange.only(1));
  for (const dbfile of pendingUploads) {
    const file = new File([dbfile.blob], dbfile.filename);
    await uploadFileToWfs(dbfile.gid, dbfile.filename, dbfile.filesize, dbfile.mimetype, dbfile.userids, file)
    //set cached entry to not pending
    dbfile.uploadpending = 0;
    idb.transaction('file', 'readwrite').objectStore('file').put(dbfile);
  }

  // sync locally cached deletes
  fileStore = idb.transaction('file', 'readonly').objectStore('file');
  const pendingRemovals = await fileStore.index('removalpending').getAll(IDBKeyRange.only(1));
  for (const dbfile of pendingRemovals) {
    deleteFile(dbfile.filename);
  }

  // re-read remote and local state again
  const filesRemote = await fetchWfsFileMetadata();
  const remoteNameFileMap = new Map(filesRemote.map((remFile) => [remFile.filename, remFile]));
  const localFiles = await idb.transaction('file', 'readonly').objectStore('file').getAll();
  const localNameFileMap = new Map(localFiles.map(dbfile => [dbfile.filename, dbfile]));

  // download files which are present remotly, but not locally
  const filesMissingLocallyMap = new Map(remoteNameFileMap);
  localNameFileMap.forEach(dbfile => filesMissingLocallyMap.delete(dbfile.filename));
  for(const [fileName, fileMetaData] of filesMissingLocallyMap){
    const file = await downloadFile(fileName);
    idb.transaction('file', 'readwrite').objectStore('file').put({
      ...fileMetaData,
      uploadPending : 0,
      gid: fileMetaData.psiteid,
      blob : file
    });
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


async function uploadFileToWfs(id, filename, filesize, mimetype, userids, file) {
  const urlResult = await readAsDataURL(file);
  const dataWithoutLink = urlResult.data.substring(urlResult.data.indexOf(',') + 1);

  const request = `<wfs:Transaction service="WFS" version="1.1.0"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:wfstest="wfstest"> 

    <wfs:Insert>
        <wfstest:protectedsite_files_view>
            <wfstest:psiteid>${id}</wfstest:psiteid>
            <wfstest:filename>${filename}</wfstest:filename>
            <wfstest:filesize>${filesize}</wfstest:filesize>
            <wfstest:mimetype>${mimetype}</wfstest:mimetype>
            <wfstest:userids>${userids}</wfstest:userids>
            <wfstest:fdata>${dataWithoutLink}</wfstest:fdata>
        </wfstest:protectedsite_files_view>
    </wfs:Insert>
  </wfs:Transaction>`;

  await fetchWithCreds('https://192.168.56.101:8443/geoserver/wfs', 
  {
    method : 'POST', 
    body : request
  });
}

async function createFileContents(feature, id, content, coordinate) {
  let files = [];
  if(isOnline) {
    files = await fetchWfsFileMetadata(id);
  } else {
    const fileStore = idb.transaction('file', 'readonly').objectStore('file');
    const fileGidIdx = fileStore.index('gid');
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
      deleteLink.onclick = (e) => { e.preventDefault(); deleteFile(file.filename); setTimeout(() => createFileContents(feature, id, content, coordinate), 100)}
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
  
  if(feature.get("owner") == localStorage.getItem("lastUser")) {
    const fileInput =  document.createElement("input", {id : "fileInput"});
    fileInput.setAttribute("type", "file");
    content.appendChild(fileInput);

    fileInput.addEventListener('change', async e => {
      var file = e.target.files[0];
      const mimetype = file.name.toLowerCase().endsWith(".gpx") ? "application/gpx+xml" : "application/octet-stream";

      let userIds = window.prompt('Beistrich-getrennte Liste von zusätzlich leseberechtigten Benutzern:');
      if(userIds) {
        userIds += ","
      }
      userIds += localStorage.getItem('lastUser'); //uploading user is always owner

      const rawBytes = await file.arrayBuffer();
      if(isOnline) {
        await uploadFileToWfs(id, file.name, rawBytes.byteLength, mimetype, userIds, file);
      }

      // Upload file to local store too
      const blob = new Blob([rawBytes], { type: mimetype });
      const fileStore = idb.transaction('file', 'readwrite').objectStore('file');
      fileStore.put({
        uploadpending : isOnline ? 0 : 1, //TODO - set to  true in case upload succeeds
        removalpending : 0,
        gid : id,
        mimetype : mimetype,
        filesize : rawBytes.byteLength,
        filename : file.name,
        userids : userIds,
        blob : blob
      });

        createFileContents(feature, id, content, coordinate)
    });

  }

  overlay.setPosition(coordinate);
}

async function downloadFile(fileName) {
  if(isOnline) {
    const fileReqTxt = await (await fetchWithCreds(`https://192.168.56.101:8443/geoserver/wfs/?service=WFS&version=2.0.0&request=GetFeature&typeNames=wfsttest:protectedsite_files_view&cql_filter=filename='${fileName}'&outputformat=json`)).text();
    const files = JSON.parse(fileReqTxt);
    const feature = files["features"][0];
    const content = feature["properties"]["fdata"];
    return b64toFile(content);
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
    const request = `<wfs:Transaction service="WFS" version="1.1.0"
    xmlns:wfs="http://www.opengis.net/wfs"
    xmlns:gml="http://www.opengis.net/gml"
    xmlns:wfstest="wfstest"> 

    <wfs:Delete typeName="wfstest:protectedsite_files_view">
      <Filter>
        <PropertyIsEqualTo>
          <PropertyName>filename</PropertyName>
          <Literal>${filename}</Literal>
        </PropertyIsEqualTo>
      </Filter>
    </wfs:Delete>
    </wfs:Transaction>`;

    const result = await fetchWithCreds('https://192.168.56.101:8443/geoserver/wfs', {method : 'POST', body : request})
    await result.text();
    idb.transaction('file', 'readwrite').objectStore('file').delete(filename);
  } else {
    const dbFile = await idb.transaction('file', 'readonly').objectStore('file').get(filename);
    dbFile.removalpending = 1;
    idb.transaction('file', 'readwrite').objectStore('file').put(dbFile);
  }
}

  map.on('click', async function(evt) {
    map.forEachFeatureAtPixel(evt.pixel,
      async function(feature, layer) {
        if(layer === vectorLayer) 
        {
          const props = feature.getProperties();
          const id = props["gid"];

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

            const attrRows = `
              <tr><td>GID</td><td>${feature.get("gid")}</td></tr>
              <tr><td>Name</td><td>${feature.get("sg_name")}</td></tr>
              <tr><td>Eigentümer</td><td>${feature.get("owner")}</td></tr>
              <tr><td>Bezirk</td><td>${feature.get("bezirk")}</td></tr>
              <tr><td>Gemeinde</td><td>${feature.get("gemeinde")}</td></tr>
              <tr><td>Fläche</td><td>${feature.get("flache_ha")}</td></tr>
              `
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