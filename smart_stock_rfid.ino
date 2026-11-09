#include <SPI.h>
#include <MFRC522.h>

#define SS_PIN D8
#define RST_PIN D3

MFRC522 leitor(SS_PIN, RST_PIN);
unsigned long ultimaMensagem = 0;

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("SMARTSTOCK|BOOT");
  SPI.begin();
  leitor.PCD_Init();
  delay(100);

  byte versao = leitor.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print("SMARTSTOCK|RC522_VERSION|0x");
  Serial.println(versao, HEX);

  if (versao == 0x00 || versao == 0xFF) {
    Serial.println("SMARTSTOCK|ERROR|RC522_NAO_RESPONDE");
  } else {
    Serial.println("SMARTSTOCK|READY");
  }
}

void loop() {
  // Sinal periódico para confirmar que o firmware está executando e transmitindo.
  if (millis() - ultimaMensagem >= 5000) {
    ultimaMensagem = millis();
    Serial.println("SMARTSTOCK|ALIVE");
  }

  if (!leitor.PICC_IsNewCardPresent()) {
    delay(20);
    return;
  }

  if (!leitor.PICC_ReadCardSerial()) {
    Serial.println("SMARTSTOCK|ERROR|FALHA_AO_LER_UID");
    delay(100);
    return;
  }

  Serial.print("SMARTSTOCK|RFID|");
  for (byte i = 0; i < leitor.uid.size; i++) {
    if (leitor.uid.uidByte[i] < 0x10) Serial.print('0');
    Serial.print(leitor.uid.uidByte[i], HEX);
    if (i < leitor.uid.size - 1) Serial.print(' ');
  }
  Serial.println();

  leitor.PICC_HaltA();
  leitor.PCD_StopCrypto1();
  delay(700);
}
