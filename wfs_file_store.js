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

export function fetchWithCreds(user, password, resource, options = {}) {
    options.headers = options.headers ?? {};
    options.headers['Authorization'] = `Basic ${window.btoa(user + ':' + password)}`;

    return fetch(resource, options);
  }

export async function fetchWfsFileMetadata(geoserver_address, file_wfs_name, user, password, gid) {
    let requestURL = geoserver_address + '/geoserver/wfs/?service=WFS&version=2.0.0&request=GetFeature&typeNames=' + file_wfs_name + '&propertyname=fid,objectid,filename,filesize,mimetype,userids&outputformat=json';
    if(gid) {
        requestURL += `&cql_filter=objectid='${gid}'`;
    }
    const fileReq = await fetchWithCreds(user, password, requestURL)
    return (await fileReq.json()).features.map(ft => ft.properties);
}

export async function downloadFileFromWFS(geoserver_address, file_wfs_name, user, password, fileName) {
    const fileReqTxt = await (await fetchWithCreds(user, password, geoserver_address + `/geoserver/wfs/?service=WFS&version=2.0.0&request=GetFeature&typeNames=${file_wfs_name}&cql_filter=filename='${fileName}'&outputformat=json`)).text();
    const files = JSON.parse(fileReqTxt);
    const feature = files["features"][0];
    const content = feature["properties"]["fdata"];
    return b64toFile(content);
}

export async function uploadFileToWfs(namespace, geoserver_address, file_wfs_name, user, password, id, filename, filesize, mimetype, userids, file) {
    const urlResult = await readAsDataURL(file);
    const dataWithoutLink = urlResult.data.substring(urlResult.data.indexOf(',') + 1);
  
    const request = `<wfs:Transaction service="WFS" version="1.1.0"
    xmlns:wfs="http://www.opengis.net/wfs"
    xmlns:gml="http://www.opengis.net/gml"
    xmlns:${namespace}="${namespace}"> 
  
      <wfs:Insert>
          <${file_wfs_name}>
              <${namespace}:objectid>${id}</${namespace}:objectid>
              <${namespace}:filename>${filename}</${namespace}:filename>
              <${namespace}:filesize>${filesize}</${namespace}:filesize>
              <${namespace}:mimetype>${mimetype}</${namespace}:mimetype>
              <${namespace}:userids>${userids}</${namespace}:userids>
              <${namespace}:fdata>${dataWithoutLink}</${namespace}:fdata>
          </${file_wfs_name}>
      </wfs:Insert>
    </wfs:Transaction>`;
  
    await fetchWithCreds(user, password, geoserver_address + '/geoserver/wfs', 
    {
      method : 'POST', 
      body : request
    });
  }

export async function deleteFileFromWFS(geoserver_address, file_wfs_name, user, password, filename) {
    const request = `<wfs:Transaction service="WFS" version="1.1.0"
    xmlns:wfs="http://www.opengis.net/wfs"
    xmlns:gml="http://www.opengis.net/gml"
    xmlns:wfstest="wfstest"> 

    <wfs:Delete typeName="${file_wfs_name}">
      <Filter>
        <PropertyIsEqualTo>
          <PropertyName>filename</PropertyName>
          <Literal>${filename}</Literal>
        </PropertyIsEqualTo>
      </Filter>
    </wfs:Delete>
    </wfs:Transaction>`;

    const result = await fetchWithCreds(user, password, geoserver_address + '/geoserver/wfs', {method : 'POST', body : request})
    return result.text();
  }



