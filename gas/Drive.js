/**
 * Drive.js — 클럽 공유드라이브 표준 폴더 구조 생성
 *
 * Script Property DRIVE_FOLDER_ID(공유드라이브 ID 또는 폴더 ID) 아래에 표준 폴더를 만든다.
 * 이미 있는 폴더는 건너뛰므로 여러 번 실행해도 안전(멱등). 에디터에서 setupDriveFolders 실행.
 * 폴더 목록은 Club.js 의 CLUB.driveFolders 로 클럽별 교체 가능(없으면 아래 기본값).
 */
var DEFAULT_DRIVE_FOLDERS = [
  '01_창립·정관', '02_회원명부·가입신청서', '03_회의록·총회', '04_재무(회비·장부·영수증)',
  '05_봉사활동', '06_행사사진', '07_지구·RI 공문', '99_봇데이터'
];

function setupDriveFolders() {
  var rootId = getProp_('DRIVE_FOLDER_ID', true);
  var root = DriveApp.getFolderById(rootId);
  var names = (CLUB.driveFolders && CLUB.driveFolders.length) ? CLUB.driveFolders : DEFAULT_DRIVE_FOLDERS;
  var made = [], kept = [];
  names.forEach(function (name) {
    if (root.getFoldersByName(name).hasNext()) { kept.push(name); return; }
    root.createFolder(name);
    made.push(name);
  });
  Logger.log('✅ 폴더 생성 ' + made.length + '개: ' + made.join(', ') + '\n   기존 유지 ' + kept.length + '개: ' + kept.join(', '));
  return { made: made, kept: kept };
}
