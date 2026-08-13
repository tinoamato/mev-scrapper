#!/usr/bin/env python
# -*- coding: utf-8 -*-
# ============================================================
# MEV scraper runner (server-side)
# ============================================================
# Reads JSON from stdin and prints JSON to stdout.
#
# Actions:
# - catalog_departamentos -> ["Departamento", ...]
# - catalog_juzgados      -> ["Juzgado", ...] (requires departamento)
# - search_by_caratula    -> [{"caratula": "...", "url": "..."}, ...] (requires juzgado, query)
# - check_last_movement   -> [{"id": "...", "lastMovementAt": "ISO", "lastMovementTitle": "..."}, ...]
#
# Notes:
# - Designed to replicate existing local scripts:
#   - "Generador csv.py" (departamento/juzgado + buscar por carátula)
#   - "Scrapper.py" (visita URL directa de procesales.asp y toma último movimiento)
# ============================================================

import json
import os
import sys
import io
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# Configurar UTF-8 para stdin/stdout (crítico en Windows)
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
if sys.stdin.encoding != 'utf-8':
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service as ChromeService


MEV_BASE = "https://mev.scba.gov.ar/"
MEV_LOGIN_URL = "https://mev.scba.gov.ar/loguin.asp"
MEV_BUSQUEDA_URL = "https://mev.scba.gov.ar/Busqueda.asp"
MEV_POSLOGUIN_URL = "https://mev.scba.gov.ar/POSLoguin.asp"

TIMEOUT = int(os.getenv("MEV_TIMEOUT_SEC", "30"))
TIMEOUT_LONG = int(os.getenv("MEV_TIMEOUT_LONG_SEC", "120"))


@dataclass
class SearchResult:
  caratula: str
  url: str
  numeroExpediente: str = ""


def _clean_text(s: str) -> str:
  return " ".join((s or "").replace("\u00a0", " ").strip().split())


def normalize_url(u: str) -> str:
  u = (u or "").strip()
  if not u:
    return u
  if u.lower().startswith("http://") or u.lower().startswith("https://"):
    return u
  u = u.lstrip("/")
  return MEV_BASE + u


def make_driver() -> webdriver.Chrome:
  opts = Options()

  headless_env = os.getenv("MEV_HEADLESS", "1").strip().lower()
  headless = headless_env not in ("0", "false", "no")
  if headless:
    opts.add_argument("--headless=new")

  # Opciones básicas de ventana y seguridad
  opts.add_argument("--window-size=1920,1080")
  opts.add_argument("--start-maximized")
  opts.add_argument("--disable-notifications")
  opts.add_argument("--disable-popup-blocking")
  
  # Opciones para estabilidad en Windows
  opts.add_argument("--no-sandbox")
  opts.add_argument("--disable-dev-shm-usage")
  opts.add_argument("--disable-gpu")
  opts.add_argument("--disable-software-rasterizer")
  opts.add_argument("--disable-blink-features=AutomationControlled")
  opts.add_argument("--disable-features=VizDisplayCompositor")
  opts.add_argument("--remote-debugging-port=0")
  opts.add_argument("--log-level=3")
  opts.add_argument("--disable-web-security")
  opts.add_argument("--allow-running-insecure-content")
  opts.add_argument("--ignore-certificate-errors")

  # Rendimiento
  opts.add_argument("--disable-extensions")
  opts.add_argument("--disable-images")
  opts.add_argument("--blink-settings=imagesEnabled=false")

  prefs = {
    "profile.managed_default_content_settings.images": 2,
    "profile.default_content_setting_values.notifications": 2,
    "intl.accept_languages": "es-AR,es,en-US,en",
    "disk-cache-size": 4096,
  }
  opts.add_experimental_option("prefs", prefs)
  opts.add_experimental_option("excludeSwitches", ["enable-logging", "enable-automation"])
  opts.add_experimental_option("useAutomationExtension", False)
  
  # Crash prevention & Low resource usage
  opts.add_argument("--disable-crash-reporter")
  opts.add_argument("--disable-breakpad")
  opts.add_argument("--disable-background-networking")
  opts.add_argument("--disable-default-apps")
  opts.add_argument("--disable-sync")
  opts.add_argument("--disable-translate")
  opts.add_argument("--metrics-recording-only")
  opts.add_argument("--no-first-run")
  opts.add_argument("--safebrowsing-disable-auto-update")
  # NOTE: --no-zygote removed — breaks renderer IPC in Chrome 112+ headless=new mode,
  # causing "Timed out receiving message from renderer" crashes.
  opts.add_argument("--disable-setuid-sandbox")
  opts.add_argument("--js-flags=--max-old-space-size=256")
  # --single-process: runs browser + renderer in the same OS process.
  # Eliminates the IPC channel that causes "Timed out receiving message from renderer"
  # in memory-constrained containers (Railway, Docker). Not officially supported but
  # is the standard fix for this crash pattern in headless CI/container environments.
  opts.add_argument("--single-process")
  # Prevent renderer from being deprioritized (extra safety on low-CPU containers)
  opts.add_argument("--disable-renderer-backgrounding")
  opts.add_argument("--disable-backgrounding-occluded-windows")
  opts.add_argument("--disable-ipc-flooding-protection")
  
  # Estrategia de carga rápida
  opts.page_load_strategy = "eager"  # eager = no espera recursos externos

  try:
    # Prefer installed binaries (Railway/Nixpacks) to avoid runtime downloads.
    chromedriver_path = os.getenv("CHROMEDRIVER_PATH", "").strip() or None
    chrome_bin = os.getenv("CHROME_BIN", "").strip() or "/usr/bin/chromium"
    
    sys.stderr.write(f"DEBUG: initializing chrome. Headless={headless}, Bin={chrome_bin}, Driver={chromedriver_path}\n")

    if chrome_bin and os.path.exists(chrome_bin):
       opts.binary_location = chrome_bin
       sys.stderr.write(f"DEBUG: Using custom chrome binary at {chrome_bin} (exists=True)\n")
    else:
       sys.stderr.write(f"DEBUG: Custom chrome binary at {chrome_bin} does not exist or not set.\n")

    service = None
    if chromedriver_path and os.path.exists(chromedriver_path):
      sys.stderr.write(f"DEBUG: Using custom chromedriver at {chromedriver_path} (exists=True)\n")
      service = ChromeService(chromedriver_path)
    else:
      # Try default PATH (e.g. chromedriver installed by nix/apt)
      sys.stderr.write("DEBUG: Trying default chromedriver from PATH\n")
      try:
        service = ChromeService("chromedriver")
      except Exception as e:
        sys.stderr.write(f"DEBUG: Failed to use PATH chromedriver: {e}\n")
        service = None

    if service is None:
      # Last resort: webdriver_manager download
      sys.stderr.write("DEBUG: Attempting webdriver_manager install...\n")
      try:
        path = ChromeDriverManager().install()
        sys.stderr.write(f"DEBUG: webdriver_manager installed at {path}\n")
        service = ChromeService(path)
      except Exception as e:
         sys.stderr.write(f"DEBUG: webdriver_manager install failed: {e}\n")
         raise e

    service.log_path = "/tmp/chromedriver.log"
    service.service_args = ['--verbose']

    driver = webdriver.Chrome(service=service, options=opts)
    driver.set_page_load_timeout(TIMEOUT_LONG)
    driver.implicitly_wait(1)
    return driver
  except Exception as e:
    sys.stderr.write(f"DEBUG: Failed to interactions: {str(e)}\n")
    raise RuntimeError(f"Error al inicializar ChromeDriver: {str(e)}")


def wait_present(driver: webdriver.Chrome, by, value, timeout=TIMEOUT):
  return WebDriverWait(driver, timeout).until(EC.presence_of_element_located((by, value)))


def wait_visible(driver: webdriver.Chrome, by, value, timeout=TIMEOUT):
  return WebDriverWait(driver, timeout).until(EC.visibility_of_element_located((by, value)))


def wait_clickable(driver: webdriver.Chrome, by, value, timeout=TIMEOUT):
  return WebDriverWait(driver, timeout).until(EC.element_to_be_clickable((by, value)))


def set_mev_date_input(driver: webdriver.Chrome, input_id: str, date_value: str, label: str) -> str:
  """Set MEV date fields robustly (keyboard first, JS fallback) and verify final value."""
  inp = wait_visible(driver, By.ID, input_id, timeout=TIMEOUT)

  try:
    inp.click()
    inp.send_keys(Keys.CONTROL, "a")
    inp.send_keys(Keys.DELETE)
    inp.send_keys(date_value)
    inp.send_keys(Keys.TAB)
    time.sleep(0.2)
  except Exception as e:
    sys.stderr.write(f"DEBUG: {label} keyboard set failed: {e}\n")

  current_value = (inp.get_attribute("value") or "").strip()
  if current_value != date_value:
    try:
      current_value = (
        driver.execute_script(
          """
            const el = arguments[0];
            const v = arguments[1];
            el.removeAttribute('readonly');
            el.focus();
            el.value = '';
            el.value = v;
            ['input', 'change', 'blur'].forEach(evt => {
              el.dispatchEvent(new Event(evt, { bubbles: true }));
            });
            return el.value || '';
          """,
          inp,
          date_value,
        )
        or ""
      ).strip()
      time.sleep(0.1)
    except Exception as e:
      sys.stderr.write(f"DEBUG: {label} JS fallback set failed: {e}\n")

  final_value = (inp.get_attribute("value") or current_value or "").strip()
  max_len = (inp.get_attribute("maxlength") or "").strip()
  sys.stderr.write(
    f"DEBUG: Fecha {label} esperada={date_value}, valor_en_campo={final_value}, maxlength={max_len}\n"
  )

  if final_value != date_value:
    raise RuntimeError(
      f"No se pudo setear fecha {label} correctamente en MEV: esperado '{date_value}', obtenido '{final_value}'"
    )

  return final_value


def is_login_page(driver: webdriver.Chrome) -> bool:
  try:
    driver.find_element(By.NAME, "usuario")
    driver.find_element(By.NAME, "clave")
    return True
  except Exception:
    return False


def is_expediente_page(driver: webdriver.Chrome) -> bool:
  try:
    driver.find_element(By.XPATH, "//*[contains(., 'Pasos Procesales')]")
    return True
  except Exception:
    return False


def accept_alert_if_present(driver: webdriver.Chrome, timeout_sec: float = 1.5) -> Optional[str]:
  try:
    WebDriverWait(driver, timeout_sec).until(EC.alert_is_present())
    a = driver.switch_to.alert
    msg = a.text
    a.accept()
    return msg
  except Exception:
    return None


def login(driver: webdriver.Chrome, username: str, password: str) -> None:
  try:
    sys.stderr.write(f"DEBUG: Navegando a {MEV_LOGIN_URL}\n")
    driver.get(MEV_LOGIN_URL)
  except Exception as e:
    sys.stderr.write(f"ERROR: No se pudo cargar la página de login: {e}\n")
    raise

  try:
    username = (username or "").strip()
    password = (password or "").strip()

    def submit_login_once() -> Optional[str]:
      u = wait_visible(driver, By.NAME, "usuario", timeout=TIMEOUT_LONG)
      p = wait_visible(driver, By.NAME, "clave", timeout=TIMEOUT_LONG)

      u.clear()
      u.send_keys(username)
      p.clear()
      p.send_keys(password)

      # Fallback JS set in case the field loses typed value due page scripts.
      try:
        driver.execute_script(
          """
            const u = document.getElementsByName('usuario')[0];
            const p = document.getElementsByName('clave')[0];
            if (u) u.value = arguments[0];
            if (p) p.value = arguments[1];
          """,
          username,
          password,
        )
      except Exception:
        pass

      wait_clickable(driver, By.ID, "Submit1", timeout=TIMEOUT_LONG).click()
      return accept_alert_if_present(driver, timeout_sec=1.2)

    alert_msg = submit_login_once()
    if alert_msg:
      sys.stderr.write(f"DEBUG: Alert de login detectado: {alert_msg}\n")
      msg_low = alert_msg.lower()
      if "contrase" in msg_low or "usuario" in msg_low:
        # Retry once when MEV validates empty credentials unexpectedly.
        alert_msg = submit_login_once()
        if alert_msg:
          raise RuntimeError(f"MEV alert en login: {alert_msg}")
    
    # MEV a veces muestra una página de transición si ya hay una sesión abierta
    # "Usted ya ha iniciado sesión... ¿Desea continuar?"
    time.sleep(2)
    accept_alert_if_present(driver, timeout_sec=0.8)
    url_low = driver.current_url.lower()
    if "loguin.asp" in url_low or "principal.asp" not in url_low:
      body_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
      if "sesión" in body_text and ("iniciada" in body_text or "abierta" in body_text):
        sys.stderr.write("DEBUG: Detectada sesión previa abierta, intentando continuar...\n")
        btns = driver.find_elements(By.XPATH, "//input[@type='submit' or @type='button']")
        for b in btns:
          val = (b.get_attribute("value") or "").lower()
          if any(x in val for x in ["entrar", "continuar", "aceptar"]):
            b.click()
            time.sleep(1)
            break

    WebDriverWait(driver, TIMEOUT_LONG).until(lambda d: not is_login_page(d))
    sys.stderr.write("DEBUG: Login exitoso\n")
  except Exception as e:
    sys.stderr.write(f"ERROR en login: {e}\n")
    raise


def ensure_logged_in(driver: webdriver.Chrome, username: str, password: str) -> None:
  if is_login_page(driver):
    login(driver, username, password)


def get_departamentos(driver: webdriver.Chrome) -> List[str]:
  try:
    sel_el = wait_present(driver, By.NAME, "DtoJudElegido", timeout=TIMEOUT_LONG)
    sel = Select(sel_el)
  except TimeoutException:
    sys.stderr.write(f"ERROR: Timeout esperando DtoJudElegido. URL actual: {driver.current_url}\n")
    # Intentar ver si hay un error de login que no detectamos
    body_text = driver.find_element(By.TAG_NAME, "body").text
    if "usuario" in body_text.lower() and "clave" in body_text.lower():
       raise RuntimeError("MEV: No se pudo iniciar sesión (sigue en página de login)")
    raise
  
  out: List[str] = []
  for o in sel.options:
    t = (o.text or "").strip()
    if t and "seleccione" not in t.lower():
      out.append(t)
  return out


def select_departamento(driver: webdriver.Chrome, depto_text: str) -> None:
  sel = Select(wait_present(driver, By.NAME, "DtoJudElegido", timeout=TIMEOUT_LONG))
  
  # Intentar match exacto primero
  try:
    sel.select_by_visible_text(depto_text)
  except Exception:
    # Buscar por match parcial
    target_normalized = depto_text.lower().strip()
    for option in sel.options:
      option_text = (option.text or "").strip()
      if target_normalized in option_text.lower() or option_text.lower() in target_normalized:
        sel.select_by_visible_text(option_text)
        break
    else:
      available = [o.text.strip() for o in sel.options if o.text.strip() and "seleccione" not in o.text.lower()]
      raise ValueError(f"No se encontró departamento '{depto_text}'. Disponibles: {available[:5]}")

  btn = wait_clickable(driver, By.CSS_SELECTOR, "form#FORM2 input[type='submit']", timeout=TIMEOUT_LONG)
  btn.click()

  wait_present(driver, By.NAME, "JuzgadoElegido", timeout=TIMEOUT_LONG)


def get_juzgados(driver: webdriver.Chrome) -> List[str]:
  sel = Select(wait_present(driver, By.NAME, "JuzgadoElegido", timeout=TIMEOUT_LONG))
  out: List[str] = []
  for o in sel.options:
    t = (o.text or "").strip()
    if t and "seleccione" not in t.lower():
      out.append(t)
  return out


def go_to_busqueda(driver: webdriver.Chrome) -> None:
  driver.get(MEV_BUSQUEDA_URL)
  time.sleep(1)  # Pequeño delay para que cargue la página
  wait_present(driver, By.NAME, "JuzgadoElegido", timeout=TIMEOUT_LONG)


def select_juzgado_in_busqueda(driver: webdriver.Chrome, juzgado_text: str) -> None:
  sel = Select(wait_present(driver, By.NAME, "JuzgadoElegido", timeout=TIMEOUT_LONG))
  
  # Intentar match exacto primero
  try:
    sel.select_by_visible_text(juzgado_text)
    return
  except Exception:
    pass
  
  # Si no funciona, buscar por match parcial (ignorando ° vs n°, etc.)
  target_normalized = juzgado_text.lower().replace("°", "").replace("n ", "n").strip()
  
  for option in sel.options:
    option_text = (option.text or "").strip()
    option_normalized = option_text.lower().replace("°", "").replace("n ", "n").strip()
    
    if target_normalized in option_normalized or option_normalized in target_normalized:
      sel.select_by_visible_text(option_text)
      return
  
  # Si aún no encuentra, listar opciones disponibles
  available = [o.text.strip() for o in sel.options if o.text.strip() and "seleccione" not in o.text.lower()]
  raise ValueError(f"No se encontró juzgado '{juzgado_text}'. Disponibles: {available[:5]}")


def _is_still_on_search_page(driver: webdriver.Chrome) -> bool:
  """Check if we're still on the search page (no results found)."""
  try:
    return len(driver.find_elements(By.ID, "caratula")) > 0
  except Exception:
    return False


def _wait_for_search_results(driver: webdriver.Chrome) -> bool:
  """Wait for search results to appear. Returns True if results found."""
  try:
    WebDriverWait(driver, 8).until(
      lambda d: len(
        d.find_elements(
          By.XPATH,
          "//div[contains(@class,'AnchoFijoCaratula')]//a[contains(@href,'procesales.asp')]",
        )
      ) > 0
      or "no se encontraron" in ((d.find_element(By.TAG_NAME, "body").text or "").lower())
    )
    return True
  except TimeoutException:
    return False


def _extract_search_results(driver: webdriver.Chrome) -> List[SearchResult]:
  """Extract and deduplicate search results from page."""
  body_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
  if "no se encontraron" in body_text or "no se encontró" in body_text:
    return []

  out: List[SearchResult] = []
  
  # MEV muestra resultados en una tabla con checkboxes
  # La estructura es: checkbox | carátula (link naranja) | número expediente | número expediente 2 | fecha | última actuación
  try:
    # Buscar todos los checkboxes en la página (excepto el de "seleccionar todos")
    # Los checkboxes de resultados individuales no tienen onclick
    checkboxes = driver.find_elements(By.XPATH, "//input[@type='checkbox' and not(@onclick)]")
    
    for checkbox in checkboxes:
      try:
        # Subir al TR que contiene este checkbox
        tr = checkbox.find_element(By.XPATH, "./ancestor::tr[1]")
        
        # Buscar el link a procesales.asp en esta fila (es la carátula)
        links = tr.find_elements(By.XPATH, ".//a[contains(@href, 'procesales.asp')]")
        if not links:
          continue
        
        link = links[0]
        caratula = _clean_text(link.text)
        href = normalize_url(link.get_attribute("href") or "")
        
        if not caratula:
          continue
        
        # Obtener todas las celdas de esta fila
        tds = tr.find_elements(By.TAG_NAME, "td")
        
        # Intentar extraer el número de expediente
        # MEV muestra DOS números de expediente iguales - necesitamos el de la DERECHA (segundo)
        # Típicamente en formato "LM - 47495 - 2016" o "D - 1571"
        numero_exp = ""
        found_numbers = []
        
        # Recorrer las celdas buscando TODOS los patrones de número de expediente
        for i, td in enumerate(tds):
          text = _clean_text(td.text)
          
          # Saltar la celda del checkbox y la de la carátula
          if i == 0 or text == caratula:
            continue
          
          # Validar texto como posible número de expediente:
          # - No debe ser fecha (tiene /).
          # - Debe tener al menos un dígito.
          # - No debe ser placeholders conocidos como "0-0", "0-", "0".
          # - Longitud razonable
          if text and len(text) < 50 and "/" not in text:
             if any(c.isdigit() for c in text):
                 # Filtrar placeholders específicos
                 if text.strip() in ("0-0", "0", "0-", "00"):
                     continue
                 found_numbers.append(text)

        # HACK: A veces la info está en la siguiente fila (tr).
        # Buscar el siguiente TR y si NO tiene checkbox (o input de seleccion), asumir que es parte del mismo resultado.
        try:
          tr_next = tr.find_element(By.XPATH, "following-sibling::tr[1]")
          # Verificar que no sea el inicio de otro resultado (que tendría checkbox)
          # Los inputs de selección suelen ser name='seleccion' o type='checkbox'
          if not tr_next.find_elements(By.XPATH, ".//input[@type='checkbox']"):
             tds_next = tr_next.find_elements(By.TAG_NAME, "td")
             for td in tds_next:
                text = _clean_text(td.text)
                if text and len(text) < 50 and "/" not in text:
                   if any(c.isdigit() for c in text):
                       if text.strip() in ("0-0", "0", "0-", "00"):
                           continue
                       found_numbers.append(text)
        except Exception:
          pass

        # Si encontramos números, tomar el ÚLTIMO (el de la derecha)
        # Esto soluciona casos donde la columna 2 es inválida/vieja y la 3 es la correcta
        if found_numbers:
          numero_exp = found_numbers[-1]
        
        out.append(SearchResult(caratula=caratula, url=href, numeroExpediente=numero_exp))
      
      except Exception as e:
        # Si falla un resultado individual, continuar con los demás
        continue
  
  except Exception as e:
    # Si falla el método de checkboxes, intentar método alternativo
    # Buscar directamente los links naranjas a procesales.asp
    try:
      # Buscar links que contengan procesales.asp
      links = driver.find_elements(By.XPATH, "//a[contains(@href, 'procesales.asp')]")
      
      for link in links:
        try:
          caratula = _clean_text(link.text)
          href = normalize_url(link.get_attribute("href") or "")
          
          if not caratula:
            continue
          
          # Intentar obtener el TR padre para extraer el número de expediente
          tr = link.find_element(By.XPATH, "./ancestor::tr[1]")
          tds = tr.find_elements(By.TAG_NAME, "td")
          
          found_numbers_fallback = []
          for td in tds:
            text = _clean_text(td.text)
            if text and text != caratula and "/" not in text and len(text) < 50:
              if any(c.isdigit() for c in text):
                 if text.strip() in ("0-0", "0", "0-", "00"):
                     continue
                 found_numbers_fallback.append(text)
          
          # HACK: Mirar siguiente fila tambien en fallback
          try:
            tr_next = tr.find_element(By.XPATH, "following-sibling::tr[1]")
            if not tr_next.find_elements(By.XPATH, ".//input[@type='checkbox']"):
                tds_next = tr_next.find_elements(By.TAG_NAME, "td")
                for td in tds_next:
                    text = _clean_text(td.text)
                    if text and len(text) < 50 and "/" not in text:
                        if any(c.isdigit() for c in text):
                            if text.strip() in ("0-0", "0", "0-", "00"):
                                continue
                            found_numbers_fallback.append(text)
          except Exception:
              pass

          if found_numbers_fallback:
            numero_exp = found_numbers_fallback[-1]
          
          out.append(SearchResult(caratula=caratula, url=href, numeroExpediente=numero_exp))
        except Exception:
          continue
    except Exception:
      pass

  # Deduplicate by URL
  seen_urls = set()
  final_res = []
  for r in out:
    if r.url:
      if r.url in seen_urls:
        continue
      seen_urls.add(r.url)
    final_res.append(r)
  
  return final_res


def search_expedientes_by_caratula(driver: webdriver.Chrome, caratula_query: str) -> List[SearchResult]:
  caratula_query = (caratula_query or "").strip()
  if len(caratula_query) < 3:
    raise ValueError("MEV exige al menos 3 caracteres para buscar por carátula.")

  try:
    # Primero, asegurarse de que el radio button "Buscar por Carátula" esté seleccionado
    # Buscar el radio button por su valor o por el texto asociado
    radio_buttons = driver.find_elements(By.XPATH, "//input[@type='radio']")
    for radio in radio_buttons:
      # Buscar el label o texto cercano para identificar el radio correcto
      try:
        parent = radio.find_element(By.XPATH, "./..")
        if "carátula" in parent.text.lower():
          if not radio.is_selected():
            radio.click()
            time.sleep(0.5)
          break
      except Exception:
        continue
    
    # Esperar a que aparezca el campo de carátula
    inp = wait_visible(driver, By.ID, "caratula", timeout=TIMEOUT_LONG)
    inp.clear()
    time.sleep(0.3)
    inp.send_keys(caratula_query)
    time.sleep(0.5)
    
  except TimeoutException:
    raise RuntimeError("No se pudo encontrar el campo de búsqueda por carátula en MEV")

  try:
    # Buscar el botón "Buscar" - puede tener diferentes IDs o ser un input type="submit"
    buscar_btn = None
    try:
      buscar_btn = wait_clickable(driver, By.ID, "buscar", timeout=5)
    except TimeoutException:
      # Intentar buscar por value o texto
      buttons = driver.find_elements(By.XPATH, "//input[@type='submit' or @type='button']")
      for btn in buttons:
        if "buscar" in (btn.get_attribute("value") or "").lower():
          buscar_btn = btn
          break
    
    if not buscar_btn:
      raise RuntimeError("No se pudo encontrar el botón buscar")
    
    buscar_btn.click()
    
  except TimeoutException:
    raise RuntimeError("No se pudo hacer clic en el botón buscar en MEV")

  # Esperar a que se procese la búsqueda
  msg = accept_alert_if_present(driver, timeout_sec=2)
  if msg:
    # Si hay un alert, podría ser un error de validación
    if "caracteres" in msg.lower() or "mínimo" in msg.lower():
      raise RuntimeError(f"MEV requiere más caracteres: {msg}")
    raise RuntimeError(f"MEV alert: {msg}")

  # Esperar a que cambie la página o aparezcan resultados
  time.sleep(3)

  # Verificar si seguimos en la página de búsqueda (sin resultados)
  if _is_still_on_search_page(driver):
    # Podría ser que no encontró resultados, o que la búsqueda no se ejecutó
    # Verificar si hay un mensaje de "no se encontraron"
    try:
      body_text = driver.find_element(By.TAG_NAME, "body").text.lower()
      if "no se encontraron" in body_text or "no se encontró" in body_text:
        return []
    except Exception:
      pass
    
    # Si no hay mensaje de error, intentar extraer resultados de todas formas
    # (a veces MEV muestra resultados en la misma página)
    results = _extract_search_results(driver)
    if results:
      return results
    
    return []

  # Esperar a que aparezcan los resultados
  if not _wait_for_search_results(driver):
    # Verificar nuevamente si hay resultados
    results = _extract_search_results(driver)
    if results:
      return results
    return []
  
  time.sleep(1)  # Ensure stable DOM

  return _extract_search_results(driver)


def parse_mev_datetime(s: str) -> Optional[datetime]:
  s = (s or "").strip()
  for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
    try:
      return datetime.strptime(s, fmt)
    except ValueError:
      continue
  return None


def extract_expediente_info(driver: webdriver.Chrome) -> Dict[str, Any]:
  """
  Extraer información completa del expediente desde la página procesales.asp.
  Campos: numeroExpediente, caratula, fechaInicio, estado
  """
  info: Dict[str, Any] = {}
  
  try:
    # Buscar la sección "Datos del Expediente" - toda la info está ahí
    # A veces está en un iframe o tabla específica, pero está en el body text visible.
    body_text = driver.find_element(By.TAG_NAME, "body").text
    
    # Extraer Número de Expediente
    # Patrones más laxos para capturar "Nro de Expediente: [Valor]" hasta el fin de línea o siguiente etiqueta
    numero_patterns = [
      r"N[º°]?\s*de\s*Expediente[:\s]+([^\n\r]+)",  # Captura todo el resto de la linea
      r"Expediente[:\s]+([A-Z0-9\s\-]+)",
    ]
    import re
    for pattern in numero_patterns:
      match = re.search(pattern, body_text, re.IGNORECASE)
      if match:
        raw_num = match.group(1).split("Carátula")[0] # Cortar si agarra de mas
        raw_num = raw_num.split("Fecha")[0].strip()
        cleaned_num = _clean_text(raw_num)
        # Validar que tenga sentido (al menos un digito o longitud minima)
        # Y que no sea un placeholder
        if len(cleaned_num) > 2 and cleaned_num not in ("0-0", "0-", "00"):
            info["numeroExpediente"] = cleaned_num
            break
    
    # Extraer Carátula
    # Buscar el texto después de "Carátula:" hasta el próximo campo
    caratula_match = re.search(r"Car[áa]tula[:\s]+(.+?)(?:Fecha\s+inicio|N[º°]\s*de\s*Receptor|Estado|$)", body_text, re.IGNORECASE | re.DOTALL)
    if caratula_match:
      caratula_text = caratula_match.group(1).strip()
      info["caratula"] = _clean_text(caratula_text)
    
    # Extraer Fecha de inicio
    fecha_match = re.search(r"Fecha\s+inicio[:\s]+(\d{1,2}/\d{1,2}/\d{4})", body_text, re.IGNORECASE)
    if fecha_match:
      fecha_str = fecha_match.group(1)
      fecha_dt = parse_mev_datetime(fecha_str)
      if fecha_dt:
        info["fechaInicio"] = fecha_dt.isoformat(sep="T", timespec="seconds")
    
    # Extraer Estado
    estado_match = re.search(r"Estado[:\s]+([^\n\r]+)", body_text, re.IGNORECASE)
    if estado_match:
        estado_raw = estado_match.group(1).strip()
        # Limpiar si agarró algo de más
        estado_clean = _clean_text(estado_raw.split("Dependencia")[0])
        info["estado"] = estado_clean
  
  except Exception as e:
    # Si falla la extracción, devolver lo que se pudo obtener
    pass
  
  return info


def extract_last_movement(driver: webdriver.Chrome) -> Optional[Tuple[datetime, str]]:
  rows = driver.find_elements(By.XPATH, "//table[contains(@class,'pegada')]//tr[td]")

  best_dt: Optional[datetime] = None
  best_title: str = ""

  for tr in rows:
    tds = tr.find_elements(By.TAG_NAME, "td")
    if len(tds) < 4:
      continue

    fecha_txt = _clean_text(tds[0].text)
    dt = parse_mev_datetime(fecha_txt)
    if not dt:
      continue

    try:
      titulo = _clean_text(tds[3].find_element(By.TAG_NAME, "a").text)
    except Exception:
      titulo = _clean_text(tds[3].text)

    if not best_dt or dt > best_dt:
      best_dt = dt
      best_title = titulo

  if not best_dt:
    return None
  return best_dt, best_title


def action_check_last_movement(
  driver: webdriver.Chrome,
  username: str,
  password: str,
  expedientes: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
  results: List[Dict[str, Any]] = []

  # Intentos maximos por expediente para evitar loops infinitos
  MAX_RETRIES = 2
  total = len(expedientes)

  for idx, exp in enumerate(expedientes):
    exp_id = (exp or {}).get("id")
    url = normalize_url((exp or {}).get("url") or "")
    if not exp_id or not url:
      continue

    # Heartbeat: keeps the Node.js idle watchdog alive between expedientes
    sys.stderr.write(f"[MEV] Procesando expediente {idx + 1}/{total} id={exp_id}\n")
    sys.stderr.flush()

    retry_count = 0
    while retry_count <= MAX_RETRIES:
        try:
            driver.get(url)
            sys.stderr.write(f"[MEV] Página cargada para {exp_id}, verificando sesión...\n")
            sys.stderr.flush()

            # sesión expirada: reloguea y reintenta
            if is_login_page(driver):
              login(driver, username, password)
              driver.get(url)

            ensure_logged_in(driver, username, password)

            sys.stderr.write(f"[MEV] Esperando contenido del expediente {exp_id}...\n")
            sys.stderr.flush()
            try:
              WebDriverWait(driver, TIMEOUT_LONG).until(lambda d: is_expediente_page(d))
            except TimeoutException:
              sys.stderr.write(f"[MEV] Timeout esperando expediente {exp_id}, saltando...\n")
              sys.stderr.flush()
              break

            last = extract_last_movement(driver)
            if not last:
              break

            dt, titulo = last
            
            # También extraer información completa del expediente
            exp_info = extract_expediente_info(driver)
            
            result_data = {
              "id": str(exp_id),
              "lastMovementAt": dt.isoformat(sep="T", timespec="seconds"),
              "lastMovementTitle": titulo or None,
            }
            
            # Agregar campos adicionales si se extrajeron
            if exp_info.get("numeroExpediente"):
              result_data["numeroExpediente"] = exp_info["numeroExpediente"]
            if exp_info.get("caratula"):
              result_data["caratula"] = exp_info["caratula"]
            if exp_info.get("fechaInicio"):
              result_data["fechaInicio"] = exp_info["fechaInicio"]
            if exp_info.get("estado"):
              result_data["estado"] = exp_info["estado"]
            
            results.append(result_data)
            # Exito, salir del while de retries
            break

        except Exception as e:
            msg = str(e).lower()
            is_crash = "session" in msg or "crash" in msg or "disconnected" in msg or "socket" in msg
            
            if is_crash and retry_count < MAX_RETRIES:
                sys.stderr.write(f"DEBUG: Detectado crash ({msg}). Reiniciando driver... (Intento {retry_count+1})\n")
                try:
                    driver.quit()
                except:
                    pass
                
                # Recrear driver y login
                try:
                    driver = make_driver()
                    login(driver, username, password)
                    retry_count += 1
                    continue # Reintentar el while
                except Exception as e2:
                    sys.stderr.write(f"DEBUG: Falló recuperación del driver: {e2}\n")
                    # Si falla la recuperacion, probablemente no podamos seguir
                    raise e2
            else:
                # Error no recuperable o max retries
                sys.stderr.write(f"DEBUG: Error procesando expediente {exp_id}: {msg}\n")
                break

  return results


def select_departamento_fuero_familia(driver: webdriver.Chrome, depto_text: str) -> None:
  """Navigate to POSLoguin, select departamento, check Fuero Familia, submit."""
  # Go to POSLoguin if not already there
  if "posloguin" not in driver.current_url.lower():
    driver.get(MEV_POSLOGUIN_URL)
    time.sleep(1)

  # Select departamento
  sel_el = wait_present(driver, By.NAME, "DtoJudElegido", timeout=TIMEOUT_LONG)
  sel = Select(sel_el)
  try:
    sel.select_by_visible_text(depto_text)
  except Exception:
    target = depto_text.lower().strip()
    for opt in sel.options:
      opt_text = (opt.text or "").strip()
      if target in opt_text.lower() or opt_text.lower() in target:
        sel.select_by_visible_text(opt_text)
        break
    else:
      available = [o.text.strip() for o in sel.options if o.text.strip() and "seleccione" not in o.text.lower()]
      raise ValueError(f"No se encontró departamento '{depto_text}'. Disponibles: {available[:5]}")

  # Check Fuero Familia checkbox (id=TipoF1, name=TipoF, value=FF)
  try:
    familia_cb = wait_present(driver, By.ID, "TipoF1", timeout=TIMEOUT)
    if not familia_cb.is_selected():
      familia_cb.click()
      time.sleep(0.3)
  except Exception as e:
    sys.stderr.write(f"DEBUG: No se pudo marcar Fuero Familia checkbox: {e}\n")

  # Click Aceptar
  btn = wait_clickable(driver, By.NAME, "Aceptar", timeout=TIMEOUT_LONG)
  btn.click()
  time.sleep(1)

  # POSLoguin.asp posts to itself and sets the session context (Fuero Familia).
  # The browser stays on POSLoguin.asp — we must explicitly navigate to Busqueda.asp.
  sys.stderr.write(f"DEBUG: Post-POSLoguin URL: {driver.current_url} — navigating to Busqueda.asp\n")
  driver.get(MEV_BUSQUEDA_URL)

  # Wait for the Familia set interface to appear
  try:
    wait_present(driver, By.NAME, "SetNovedades", timeout=TIMEOUT_LONG)
    sys.stderr.write(f"DEBUG: Busqueda.asp cargado con interfaz Fuero Familia\n")
  except TimeoutException:
    body_text = driver.find_element(By.TAG_NAME, "body").text
    body_low = body_text.lower()
    if "no esta disponible" in body_low or "no está disponible" in body_low:
      raise RuntimeError(
        f"El departamento '{depto_text}' no tiene Fuero Familia disponible en MEV. "
        f"Seleccioná un departamento que tenga juzgados de familia."
      )
    raise RuntimeError(
      f"Busqueda.asp no mostró la interfaz de Fuero Familia para '{depto_text}'. "
      f"Respuesta: {body_text[:200]}"
    )


def search_novedades_fuero_familia(driver: webdriver.Chrome) -> List[SearchResult]:
  """On busqueda.asp, use Novedades en Mis Sets from 01/01/2001 to get Familia cases."""
  from datetime import date as _date

  desde_str = "01/01/2001"

  # Select radio "Novedades en Mis Sets" (value xNs)
  try:
    radio_ns = wait_present(driver, By.XPATH, "//input[@type='radio' and @value='xNs']", timeout=TIMEOUT)
    if not radio_ns.is_selected():
      radio_ns.click()
      time.sleep(0.5)
  except Exception as e:
    raise RuntimeError(f"No se encontró el radio 'Novedades en Mis Sets' en Busqueda.asp. Detalle: {e}")

  # Set Desde = "01/01/2001"
  try:
    set_mev_date_input(driver, "Desde", desde_str, "Desde")
  except Exception as e:
    sys.stderr.write(f"DEBUG: No se pudo setear campo Desde: {e}\n")
    raise RuntimeError(str(e))

  # Set Hasta = today with strict dd/mm/yyyy expected by MEV validation.
  hoy = _date.today()
  hasta_str = hoy.strftime("%d/%m/%Y")
  try:
    set_mev_date_input(driver, "Hasta", hasta_str, "Hasta")
  except Exception as e:
    sys.stderr.write(f"DEBUG: No se pudo setear campo Hasta: {e}\n")
    raise RuntimeError(str(e))

  # Select the Familia set in SetNovedades dropdown
  try:
    sel_el = wait_present(driver, By.NAME, "SetNovedades", timeout=TIMEOUT)
    sel = Select(sel_el)
    selected = False
    for opt in sel.options:
      opt_val = opt.get_attribute("value") or ""
      opt_text = (opt.text or "").lower()
      if opt_val and ("familia" in opt_text or "family" in opt_text):
        sel.select_by_value(opt_val)
        selected = True
        sys.stderr.write(f"DEBUG: Set seleccionado: {opt.text}\n")
        break
    if not selected:
      # Fallback: pick first non-empty option
      for opt in sel.options:
        opt_val = opt.get_attribute("value") or ""
        if opt_val:
          sel.select_by_value(opt_val)
          selected = True
          sys.stderr.write(f"DEBUG: Fallback set seleccionado: {opt.text}\n")
          break
    if not selected:
      available = [o.text.strip() for o in sel.options if o.get_attribute("value")]
      raise RuntimeError(
        f"No se encontró ningún Set de Fuero Familia disponible. "
        f"Opciones disponibles: {available}. "
        f"Asegurate de tener un Set de Familia configurado en MEV."
      )
    # Asegurar que la UI dispare handlers que puedan poblar JuzgadoElegido.
    try:
      driver.execute_script(
        "arguments[0].dispatchEvent(new Event('change', { bubbles: true }));",
        sel_el,
      )
      time.sleep(0.5)
    except Exception:
      pass
  except RuntimeError:
    raise
  except Exception as e:
    sys.stderr.write(f"DEBUG: No se pudo seleccionar set de novedades: {e}\n")

  def _get_juzgado_select() -> Optional[Select]:
    for _ in range(4):
      try:
        return Select(wait_present(driver, By.ID, "JuzgadoElegido", timeout=3))
      except Exception:
        pass
      try:
        return Select(wait_present(driver, By.NAME, "JuzgadoElegido", timeout=3))
      except Exception:
        pass
      time.sleep(0.5)
    return None

  def _click_submit_like(value_contains: str, fallback_id: str) -> None:
    btn = None
    try:
      btn = wait_clickable(driver, By.ID, fallback_id, timeout=4)
    except Exception:
      pass
    if btn is None:
      try:
        btn = driver.find_element(
          By.XPATH,
          f"//input[( @type='submit' or @type='button') and contains(translate(@value,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), '{value_contains.lower()}')]",
        )
      except Exception:
        btn = None
    if btn is None:
      raise RuntimeError(f"No se encontró botón para '{value_contains}'")
    btn.click()

  # Primera búsqueda desde Busqueda.asp para llegar a resultados.asp
  try:
    _click_submit_like("buscar", "buscar")
  except Exception as e:
    raise RuntimeError(f"No se pudo hacer clic en Buscar para Fuero Familia: {e}")

  time.sleep(2)
  msg = accept_alert_if_present(driver, timeout_sec=2)
  if msg:
    raise RuntimeError(f"MEV alert al buscar Fuero Familia: {msg}")

  # Ya en resultados.asp, iterar Organismos del Set con botón Consultar.
  juz_sel = _get_juzgado_select()
  if juz_sel is None:
    sys.stderr.write("DEBUG: No se encontró JuzgadoElegido en resultados; devolviendo resultados de la búsqueda actual\n")
    _wait_for_search_results(driver)
    return _extract_search_results(driver)

  juzgados: List[Tuple[str, str]] = []
  seen_juz_values = set()
  for opt in juz_sel.options:
    raw_value = opt.get_attribute("value") or ""
    text = _clean_text(opt.text or "")
    if not raw_value:
      continue
    if "seleccione" in text.lower():
      continue
    norm_key = raw_value.strip() or text.lower()
    if norm_key in seen_juz_values:
      continue
    seen_juz_values.add(norm_key)
    juzgados.append((raw_value, text))

  sys.stderr.write(f"DEBUG: Juzgados Fuero Familia detectados en resultados={len(juzgados)}\n")
  if not juzgados:
    _wait_for_search_results(driver)
    return _extract_search_results(driver)

  all_results: List[SearchResult] = []
  for idx, (juz_value, juz_text) in enumerate(juzgados, start=1):
    try:
      sel_loop = _get_juzgado_select()
      if sel_loop is None:
        sys.stderr.write(f"DEBUG: Selector JuzgadoElegido no disponible en iteración {idx}; se omite\n")
        continue

      current_value = (sel_loop.first_selected_option.get_attribute("value") or "").strip()
      target_value = (juz_value or "").strip()

      if current_value != target_value:
        try:
          sel_loop.select_by_value(juz_value)
        except Exception:
          sel_loop.select_by_visible_text(juz_text)
        time.sleep(0.3)
        _click_submit_like("consultar", "Consultar")
        time.sleep(1.5)

      msg_j = accept_alert_if_present(driver, timeout_sec=1.5)
      if msg_j:
        sys.stderr.write(f"DEBUG: Alert en juzgado '{juz_text}': {msg_j}\n")
        continue

      sys.stderr.write(
        f"DEBUG: Leyendo resultados Fuero Familia en juzgado {idx}/{len(juzgados)}: {juz_text} (value={target_value})\n"
      )
      _wait_for_search_results(driver)
      juz_results = _extract_search_results(driver)
      sys.stderr.write(f"DEBUG: Resultados en '{juz_text}': {len(juz_results)}\n")
      all_results.extend(juz_results)
    except RuntimeError:
      raise
    except Exception as e:
      sys.stderr.write(f"DEBUG: Error en juzgado '{juz_text}': {e}\n")
      continue

  # Deduplicate globally by URL across all juzgados.
  seen_urls = set()
  final_results: List[SearchResult] = []
  for r in all_results:
    if r.url:
      if r.url in seen_urls:
        continue
      seen_urls.add(r.url)
    final_results.append(r)

  return final_results


def _parse_input() -> dict:
  """Parse and validate stdin JSON input."""
  try:
    raw = sys.stdin.read().strip()
    return json.loads(raw) if raw else {}
  except json.JSONDecodeError as e:
    sys.stderr.write(f"Error: JSON inválido en stdin: {e}\n")
    sys.exit(1)


def _handle_catalog_departamentos(driver: webdriver.Chrome) -> None:
  out = get_departamentos(driver)
  sys.stdout.write(json.dumps(out, ensure_ascii=False))


def _handle_catalog_juzgados(driver: webdriver.Chrome, payload: dict) -> None:
  depto = (payload.get("departamento") or "").strip()
  if not depto:
    sys.stderr.write("Error: Falta 'departamento'\n")
    sys.exit(1)
  select_departamento(driver, depto)
  out = get_juzgados(driver)
  sys.stdout.write(json.dumps(out, ensure_ascii=False))


def _handle_search_by_caratula(driver: webdriver.Chrome, payload: dict) -> None:
  departamento = (payload.get("departamento") or "").strip()
  juzgado = (payload.get("juzgado") or "").strip()
  query = (payload.get("query") or "").strip()
  
  if not departamento:
    sys.stderr.write("Error: Falta 'departamento' para search_by_caratula\n")
    sys.exit(1)
  if not juzgado:
    sys.stderr.write("Error: Falta 'juzgado'\n")
    sys.exit(1)
  if not query:
    sys.stderr.write("Error: Falta 'query'\n")
    sys.exit(1)

  select_departamento(driver, departamento)
  go_to_busqueda(driver)
  select_juzgado_in_busqueda(driver, juzgado)
  res = search_expedientes_by_caratula(driver, query)
  out = [{"caratula": r.caratula, "url": r.url, "numeroExpediente": r.numeroExpediente} for r in res]
  sys.stdout.write(json.dumps(out, ensure_ascii=False))


def _handle_search_fuero_familia(driver: webdriver.Chrome, payload: dict) -> None:
  departamento = (payload.get("departamento") or "").strip()
  if not departamento:
    sys.stderr.write("Error: Falta 'departamento' para search_fuero_familia\n")
    sys.exit(1)

  select_departamento_fuero_familia(driver, departamento)
  res = search_novedades_fuero_familia(driver)
  out = [{"caratula": r.caratula, "url": r.url, "numeroExpediente": r.numeroExpediente} for r in res]
  sys.stdout.write(json.dumps(out, ensure_ascii=False))


def _handle_check_last_movement(driver: webdriver.Chrome, payload: dict, username: str, password: str) -> None:
  expedientes = payload.get("expedientes") or []
  if not isinstance(expedientes, list):
    sys.stderr.write("Error: 'expedientes' debe ser una lista\n")
    sys.exit(1)
  out = action_check_last_movement(driver, username, password, expedientes)
  sys.stdout.write(json.dumps(out, ensure_ascii=False))


def main() -> None:
  payload = _parse_input()

  username = (payload.get("username") or "").strip()
  password = (payload.get("password") or "").strip()
  action = (payload.get("action") or "").strip()

  if not action:
    sys.stderr.write("Error: Falta 'action' en el input\n")
    sys.exit(1)
  if not username or not password:
    sys.stderr.write("Error: Faltan credenciales (username/password)\n")
    sys.exit(1)

  driver = None
  try:
    driver = make_driver()
    login(driver, username, password)

    action_handlers = {
      "catalog_departamentos": lambda: _handle_catalog_departamentos(driver),
      "catalog_juzgados": lambda: _handle_catalog_juzgados(driver, payload),
      "search_by_caratula": lambda: _handle_search_by_caratula(driver, payload),
      "search_fuero_familia": lambda: _handle_search_fuero_familia(driver, payload),
      "check_last_movement": lambda: _handle_check_last_movement(driver, payload, username, password),
    }

    handler = action_handlers.get(action)
    if handler:
      handler()
    else:
      sys.stderr.write(f"Error: Acción no soportada: {action}\n")
      sys.exit(1)

  except Exception as e:
    import traceback
    sys.stderr.write(f"Error en MEV scraper: {str(e)}\n{traceback.format_exc()}")
    sys.exit(2)
  finally:
    if driver:
      try:
        driver.quit()
      except Exception:
        pass


if __name__ == "__main__":
  try:
    main()
  except Exception as e:
    import traceback
    sys.stderr.write(f"Error fatal: {str(e)}\n{traceback.format_exc()}\n")
    sys.exit(2)
