import {Injectable, SecurityContext} from '@angular/core';
import {BehaviorSubject} from "rxjs";
import {
  KnowledgeSource,
  KnowledgeSourceReference,
  SourceModel
} from "projects/ks-lib/src/lib/models/knowledge.source.model";
import {ExtractionService} from "../extraction/extraction.service";
import {UuidService} from "../uuid/uuid.service";
import {UuidModel} from "projects/ks-lib/src/lib/models/uuid.model";
import {FaviconExtractorService} from "../favicon/favicon-extractor.service";
import {ElectronIpcService} from "../electron-ipc/electron-ipc.service";
import {DomSanitizer} from "@angular/platform-browser";

@Injectable({
  providedIn: 'root'
})
export class ExternalIngestService {
  private externalKS = new BehaviorSubject<KnowledgeSource[]>([]);
  ks = this.externalKS.asObservable();
  private receive = window.api.receive;
  private send = window.api.send;

  constructor(private faviconService: FaviconExtractorService,
              private extractionService: ExtractionService,
              private ipcService: ElectronIpcService,
              private uuidService: UuidService,
              private sanitizer: DomSanitizer) {

    this.ipcService.browserWatcher().subscribe((link) => {
      let sanitized = this.sanitizer.sanitize(SecurityContext.URL, link);
      if (sanitized) {
        link = sanitized;
      } else {
        console.warn('Unable to sanitize URL received from browser... rejecting!');
      }

      this.extractionService.extractWebsiteMetadata(link).then((metadata) => {
        if (metadata.title) {
          const uuid: UuidModel = this.uuidService.generate(1)[0];
          let sourceLink = new URL(link);
          let source = new SourceModel(undefined, undefined, {url: link, metadata: metadata});
          let ref = new KnowledgeSourceReference('website', source, sourceLink);
          let ks = new KnowledgeSource(metadata.title, uuid, 'website', ref);
          let url = new URL(link);
          ks.iconUrl = url.hostname;
          ks.icon = this.faviconService.generic();
          this.faviconService.extract([url.hostname]).then((icons) => {
            ks.icon = icons[0];
            this.externalKS.next([ks]);
          });
        }
      }).catch((error) => {
        console.error('Extraction Service failed: ', error);
      });
    });

    this.ipcService.ingestWatcher().subscribe((fileModels) => {
      let iconRequests = [];
      let ksList: KnowledgeSource[] = [];
      for (let fileModel of fileModels) {
        iconRequests.push(fileModel.path);
      }
      this.ipcService.getFileIcon(iconRequests).then((icons) => {
        for (let i = 0; i < fileModels.length; i++) {
          let fileModel = fileModels[i];
          let sourceLink = fileModel.path;
          let source = new SourceModel(fileModel, undefined, undefined);
          let ref = new KnowledgeSourceReference('file', source, sourceLink);
          let ks = new KnowledgeSource(fileModel.filename, fileModel.id, 'file', ref);
          ks.dateAccessed = new Date(fileModel.accessTime);
          ks.dateModified = new Date(fileModel.modificationTime);
          ks.dateCreated = new Date(fileModel.creationTime);
          ks.iconUrl = this.faviconService.file();
          ks.icon = icons[i];
          ksList.push(ks);
        }
        this.externalKS.next(ksList);
      });
    });
  }
}
